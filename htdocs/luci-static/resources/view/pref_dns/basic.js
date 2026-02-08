'use strict';
'require form';
'require fs';
'require poll';
'require uci';
'require ui';
'require view';

// 检查服务是否安装（通过 init 脚本是否存在）
function checkServiceInstalled(name) {
	return fs.stat('/etc/init.d/' + name).then(function() {
		return true;
	}).catch(function() {
		return false;
	});
}

// 获取服务运行状态（通过 init 脚本 running 命令）
function getServiceStatus(name) {
	return fs.exec('/etc/init.d/' + name, ['running']).then(function(res) {
		return res.code === 0;
	}).catch(function() {
		return false;
	});
}

// 渲染服务状态
function renderServiceStatus(name, installed, running) {
	if (!installed)
		return E('span', { style: 'color:grey' }, name + ' ' + _('Not Installed'));
	if (running)
		return E('span', { style: 'color:green; font-weight:bold' }, name + ' ' + _('RUNNING'));
	return E('span', { style: 'color:red; font-weight:bold' }, name + ' ' + _('NOT RUNNING'));
}

var pollRegistered = false;

return view.extend({
	load: function() {
		return Promise.all([
			checkServiceInstalled('mosdns'),
			checkServiceInstalled('passwall'),
			checkServiceInstalled('cron'),
			uci.load('pref_dns'),
			L.resolveDefault(uci.load('mosdns'), null),
			L.resolveDefault(uci.load('passwall'), null)
		]);
	},

	handleResolve: function(m, ev) {
		var domainEl = document.getElementById('widget.cbid.pref_dns.config.domain')
			|| document.getElementById('cbid.pref_dns.config.domain');
		var dnsEl = document.getElementById('widget.cbid.pref_dns.config.dns_server')
			|| document.getElementById('cbid.pref_dns.config.dns_server');
		var domainVal = domainEl ? domainEl.value : '';
		var dnsVal = dnsEl ? dnsEl.value : '';

		if (!domainVal) {
			ui.addNotification(null, E('p', _('Please enter a domain name')), 'error');
			return;
		}
		if (!dnsVal) {
			ui.addNotification(null, E('p', _('Please select a DNS server')), 'error');
			return;
		}

		return fs.exec('/usr/share/pref_dns/pref_dns.sh', ['resolve', domainVal, dnsVal])
			.then(function(res) {
				var result;
				try {
					result = JSON.parse(res.stdout);
				} catch (e) {
					ui.addNotification(null, E('p', _('Failed to parse result')), 'error');
					return;
				}
				if (result.code === 0) {
					var msg = _('Resolved %d IP(s): ').format(result.count) + result.ips.join(', ');
					if (result.restart === 'restarted')
						msg += ' - ' + _('MosDNS restarted');
					else if (result.restart === 'saved_only')
						msg += ' - ' + _('Saved (MosDNS not running)');
					else
						msg += ' - ' + _('Saved (MosDNS not installed)');
					ui.addNotification(null, E('p', msg), 'info');
					return uci.load('mosdns').then(function() {
						return m.render();
					});
				} else {
					var errMsg = result.message || 'unknown error';
					if (errMsg === 'timeout')
						errMsg = _('DNS query timed out');
					else if (errMsg === 'no_ip_found')
						errMsg = _('No IP address found in DNS response');
					ui.addNotification(null, E('p', _('Resolve failed: ') + errMsg), 'error');
				}
			}).catch(function(e) {
				ui.addNotification(null, E('p', _('Execution error: ') + e.message), 'error');
			});
	},

	handleSaveApply: function(ev) {
		var self = this;
		return this.handleSave(ev).then(function() {
			return fs.exec('/usr/share/pref_dns/pref_dns.sh', ['commit_and_restart']);
		}).then(function(res) {
			var cronEnabled = uci.get('pref_dns', 'config', 'cron_enabled');
			var cronAction = (cronEnabled === '1') ? 'enable' : 'disable';
			return fs.exec('/usr/share/pref_dns/pref_dns.sh', ['cron', cronAction]).then(function() {
				return res;
			}).catch(function() {
				return res;
			});
		}).then(function(res) {
			var result;
			try {
				result = JSON.parse(res.stdout);
			} catch (e) {
				ui.addNotification(null, E('p', _('Configuration saved')), 'info');
				return;
			}
			var msgs = [];
			if (result.restart && result.restart.mosdns === 'restarted')
				msgs.push(_('MosDNS: saved and restarted'));
			else if (result.restart && result.restart.mosdns === 'saved_only')
				msgs.push(_('MosDNS: saved (not running, skip restart)'));
			else if (result.restart && result.restart.mosdns === 'not_installed')
				msgs.push(_('MosDNS: saved (not installed)'));

			if (result.restart && result.restart.passwall === 'restarted')
				msgs.push(_('PassWall: saved and restarted'));
			else if (result.restart && result.restart.passwall === 'saved_only')
				msgs.push(_('PassWall: saved (not running, skip restart)'));
			else if (result.restart && result.restart.passwall === 'not_installed')
				msgs.push(_('PassWall: saved (not installed)'));

			if (msgs.length > 0)
				ui.addNotification(null, E('p', msgs.join('; ')), 'info');
			else
				ui.addNotification(null, E('p', _('Configuration saved')), 'info');
		}).catch(function(e) {
			ui.addNotification(null, E('p', _('Save error: ') + e.message), 'error');
		});
	},

	render: function(data) {
		var mosdnsInstalled = data[0];
		var passwallInstalled = data[1];
		var cronInstalled = data[2];
		var m, s, o;

		m = new form.Map('pref_dns', _('Preferred DNS'),
			_('Configure MosDNS Cloudflare IP optimization and PassWall DNS settings'));

		/* === 状态栏 === */
		s = m.section(form.TypedSection);
		s.anonymous = true;
		s.render = function() {
			var statusEl = E('div', { class: 'cbi-section', id: 'status_bar' }, [
				E('p', { id: 'service_status' }, _('Collecting data...'))
			]);
			setTimeout(function() {
				if (pollRegistered) return;
				pollRegistered = true;
				poll.add(function() {
					var mosdnsPromise = mosdnsInstalled
						? getServiceStatus('mosdns')
						: Promise.resolve(false);
					var passwallPromise = passwallInstalled
						? getServiceStatus('passwall')
						: Promise.resolve(false);
					return Promise.all([mosdnsPromise, passwallPromise]).then(function(res) {
						var el = document.getElementById('service_status');
						if (!el) return;
						while (el.firstChild) el.removeChild(el.firstChild);
						el.appendChild(renderServiceStatus('MosDNS', mosdnsInstalled, res[0]));
						el.appendChild(document.createTextNode('  '));
						el.appendChild(renderServiceStatus('PassWall', passwallInstalled, res[1]));
					});
				});
			}, 100);
			return statusEl;
		};

		/* === Tab 定义 === */
		s = m.section(form.NamedSection, 'config', 'pref_dns');
		s.tab('mosdns', _('Preferred DNS'));
		s.tab('passwall', _('PassWall DNS'));

		/* === MosDNS Tab === */

		// 1. 功能开关
		o = s.taboption('mosdns', form.Flag, 'mosdns_enabled', _('Enable MosDNS Feature'),
			_('Control the visibility of MosDNS settings and operation buttons.'));
		o.default = '1';
		o.rmempty = false;
		if (!mosdnsInstalled) o.readonly = true;

		// 2. 域名配置
		o = s.taboption('mosdns', form.Value, 'domain', _('Domain'));
		o.placeholder = 'example.com';
		o.rmempty = false;
		o.datatype = 'hostname';
		o.depends('mosdns_enabled', '1');
		if (!mosdnsInstalled) o.readonly = true;

		// 3. DNS 服务器
		o = s.taboption('mosdns', form.ListValue, 'dns_server', _('DNS Server'));
		o.value('119.29.29.29', _('Tencent Public DNS (119.29.29.29)'));
		o.value('119.28.28.28', _('Tencent Public DNS (119.28.28.28)'));
		o.value('223.5.5.5', _('Aliyun Public DNS (223.5.5.5)'));
		o.value('223.6.6.6', _('Aliyun Public DNS (223.6.6.6)'));
		o.value('180.184.1.1', _('TrafficRoute Public DNS (180.184.1.1)'));
		o.value('180.184.2.2', _('TrafficRoute Public DNS (180.184.2.2)'));
		o.value('114.114.114.114', _('Xinfeng Public DNS (114.114.114.114)'));
		o.value('114.114.115.115', _('Xinfeng Public DNS (114.114.115.115)'));
		o.value('180.76.76.76', _('Baidu Public DNS (180.76.76.76)'));
		o.value('8.8.8.8', _('Google Public DNS (8.8.8.8)'));
		o.value('1.1.1.1', _('CloudFlare Public DNS (1.1.1.1)'));
		o.default = '119.29.29.29';
		o.depends('mosdns_enabled', '1');
		if (!mosdnsInstalled) o.readonly = true;

		// 4. 解析按钮
		o = s.taboption('mosdns', form.Button, '_resolve', _('Resolve'));
		o.inputtitle = _('Query and Apply');
		o.inputstyle = 'apply';
		o.onclick = L.bind(this.handleResolve, this, m);
		o.depends('mosdns_enabled', '1');
		if (!mosdnsInstalled) {
			o.readonly = true;
			o.description = E('span', { style: 'color:red' },
				_('MosDNS is not installed. This feature is unavailable.'));
		}

		// 5. 当前 IP 显示
		o = s.taboption('mosdns', form.DummyValue, '_current_ips', _('Current Cloudflare IPs'));
		o.depends('mosdns_enabled', '1');
		o.cfgvalue = function() {
			var ips = uci.get('mosdns', 'config', 'cloudflare_ip');
			if (!ips || (Array.isArray(ips) && ips.length === 0))
				return _('(none)');
			if (Array.isArray(ips))
				return ips.join(', ');
			return String(ips);
		};

		// 6. Cloudflare 功能状态
		o = s.taboption('mosdns', form.DummyValue, '_cf_status', _('Cloudflare Feature'));
		o.depends('mosdns_enabled', '1');
		o.renderWidget = function() {
			var enabled = uci.get('mosdns', 'config', 'cloudflare');
			if (enabled === '1')
				return E('span', { style: 'color:green' }, [E('strong', {}, _('Enabled'))]);
			return E('span', { style: 'color:grey' }, _('Disabled (will be auto-enabled on resolve)'));
		};

		/* === 定时解析配置 === */
		var cronPresets = {
			'*/30 * * * *': _('Every 30 minutes'),
			'0 * * * *': _('Every 1 hour'),
			'0 */6 * * *': _('Every 6 hours'),
			'0 */12 * * *': _('Every 12 hours'),
			'0 4 * * *': _('Every day at 4:00'),
			'custom': _('Custom')
		};

		if (!cronInstalled) {
			o = s.taboption('mosdns', form.DummyValue, '_cron_notice', _('Scheduled Resolve'));
			o.depends('mosdns_enabled', '1');
			o.renderWidget = function() {
				return E('span', { style: 'color:grey' },
					_('Cron service is not installed. Scheduled resolve is unavailable.'));
			};
		} else {
			o = s.taboption('mosdns', form.Flag, 'cron_enabled', _('Enable Scheduled Resolve'),
				_('Automatically resolve domain on a schedule'));
			o.default = '0';
			o.rmempty = false;
			o.depends('mosdns_enabled', '1');
			if (!mosdnsInstalled) o.readonly = true;

			o = s.taboption('mosdns', form.ListValue, '_cron_preset', _('Schedule'),
				_('Select a preset interval or choose Custom'));
			Object.keys(cronPresets).forEach(function(k) {
				o.value(k, cronPresets[k]);
			});
			o.default = '0 */6 * * *';
			o.depends({ mosdns_enabled: '1', cron_enabled: '1' });
			if (!mosdnsInstalled) o.readonly = true;
			o.cfgvalue = function() {
				var expr = uci.get('pref_dns', 'config', 'cron_expression') || '';
				if (expr && cronPresets[expr]) return expr;
				if (expr) return 'custom';
				return '0 */6 * * *';
			};
			o.write = function(section, value) {
				if (value !== 'custom')
					uci.set('pref_dns', 'config', 'cron_expression', value);
			};

			o = s.taboption('mosdns', form.Value, 'cron_expression', _('Cron Expression'),
				_('5-field cron format: min hour day month weekday'));
			o.placeholder = '0 */6 * * *';
			o.depends({ mosdns_enabled: '1', _cron_preset: 'custom' });
			o.validate = function(section, value) {
				if (!value) return _('Cron expression is required');
				if (!/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(value.trim()))
					return _('Invalid cron format (need 5 fields)');
				return true;
			};
			if (!mosdnsInstalled) o.readonly = true;
		}

		/* === PassWall Tab === */

		// 1. 功能开关
		o = s.taboption('passwall', form.Flag, 'passwall_enabled', _('Enable PassWall Feature'),
			_('Control the visibility of PassWall DNS settings.'));
		o.default = '1';
		o.rmempty = false;
		if (!passwallInstalled) o.readonly = true;

		// 未安装提示
		if (!passwallInstalled) {
			o = s.taboption('passwall', form.DummyValue, '_pw_notice');
			o.renderWidget = function() {
				return E('span', { style: 'color:red; font-weight:bold' },
					_('PassWall is not installed. Settings below are read-only.'));
			};
		}

		// 2. DNS 分流
		o = s.taboption('passwall', form.ListValue, '_pw_dns_shunt', _('DNS Shunt'));
		o.value('dnsmasq', 'Dnsmasq');
		o.value('chinadns-ng', 'ChinaDNS-NG');
		o.value('smartdns', 'SmartDNS');
		o.default = 'dnsmasq';
		o.depends('passwall_enabled', '1');
		if (!passwallInstalled) o.readonly = true;
		o.cfgvalue = function() {
			return uci.get('passwall', '@global[0]', 'dns_shunt') || 'dnsmasq';
		};
		o.write = function(section, value) {
			return uci.set('passwall', '@global[0]', 'dns_shunt', value);
		};

		// 3. 过滤模式
		o = s.taboption('passwall', form.ListValue, '_pw_dns_mode', _('Filter Mode'));
		o.value('tcp', 'TCP');
		o.value('udp', 'UDP');
		o.value('dns2socks', 'dns2socks');
		o.default = 'tcp';
		o.depends('passwall_enabled', '1');
		if (!passwallInstalled) o.readonly = true;
		o.cfgvalue = function() {
			return uci.get('passwall', '@global[0]', 'dns_mode') || 'tcp';
		};
		o.write = function(section, value) {
			return uci.set('passwall', '@global[0]', 'dns_mode', value);
		};

		// 4. 远程 DNS - 自动读取 MosDNS 监听端口
		var mosdnsPort = uci.get('mosdns', 'config', 'listen_port') || '5335';
		var defaultRemoteDns = '127.0.0.1#' + mosdnsPort;

		o = s.taboption('passwall', form.Value, '_pw_remote_dns', _('Remote DNS'),
			_('Auto-filled from MosDNS listen port. You can modify manually.'));
		o.default = defaultRemoteDns;
		o.placeholder = defaultRemoteDns;
		o.depends('passwall_enabled', '1');
		if (!passwallInstalled) o.readonly = true;
		o.cfgvalue = function() {
			return uci.get('passwall', '@global[0]', 'remote_dns') || defaultRemoteDns;
		};
		o.write = function(section, value) {
			return uci.set('passwall', '@global[0]', 'remote_dns', value);
		};

		// 5. 远程 DoH
		o = s.taboption('passwall', form.Value, '_pw_remote_dns_doh', _('Remote DNS DoH'),
			_('DoH address for remote DNS resolution'));
		o.default = 'https://1.1.1.1/dns-query';
		o.placeholder = 'https://1.1.1.1/dns-query';
		o.depends('passwall_enabled', '1');
		if (!passwallInstalled) o.readonly = true;
		o.cfgvalue = function() {
			return uci.get('passwall', '@global[0]', 'remote_dns_doh') || '';
		};
		o.write = function(section, value) {
			return uci.set('passwall', '@global[0]', 'remote_dns_doh', value);
		};

		// 6. FakeDNS
		o = s.taboption('passwall', form.Flag, '_pw_remote_fakedns', 'FakeDNS',
			_('Disable if MosDNS handles DNS shunting'));
		o.default = '0';
		o.depends('passwall_enabled', '1');
		if (!passwallInstalled) o.readonly = true;
		o.cfgvalue = function() {
			return uci.get('passwall', '@global[0]', 'remote_fakedns') || '0';
		};
		o.write = function(section, value) {
			return uci.set('passwall', '@global[0]', 'remote_fakedns', value);
		};

		// 7. DNS 重定向
		o = s.taboption('passwall', form.Flag, '_pw_dns_redirect', _('DNS Redirect'),
			_('Force redirect DNS for proxy devices'));
		o.default = '1';
		o.depends('passwall_enabled', '1');
		if (!passwallInstalled) o.readonly = true;
		o.cfgvalue = function() {
			return uci.get('passwall', '@global[0]', 'dns_redirect') || '1';
		};
		o.write = function(section, value) {
			return uci.set('passwall', '@global[0]', 'dns_redirect', value);
		};

		return m.render();
	}
});
