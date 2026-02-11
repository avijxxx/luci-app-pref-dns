'use strict';
'require form';
'require fs';
'require ui';
'require view';
'require uci';

function updateIpDisplay() {
    return uci.unload('mosdns').then(function() {
        return uci.load('mosdns');
    }).then(function() {
        var ipEl = document.querySelector('[data-name="_current_ips"] .td');
        if (!ipEl) return;
        var ips = uci.get('mosdns', 'config', 'cloudflare_ip');
        if (!ips || !Array.isArray(ips) || ips.length === 0) {
            ipEl.innerHTML = '<em>' + _('No IPs configured') + '</em>';
        } else {
            ipEl.innerHTML = '<ul style="margin:0;padding-left:1.5em">' +
                ips.map(function(ip) { return '<li>' + ip + '</li>'; }).join('') +
                '</ul>';
        }
    });
}

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('pref_dns'),
            uci.load('mosdns')
        ]);
    },

    render: function() {
        var m, s, o;

        m = new form.Map('pref_dns', _('Preferred DNS'),
            _('MosDNS Cloudflare IP optimization and PassWall DNS management'));

        // ========== Tab 1: 优选 DNS ==========
        s = m.section(form.TypedSection, 'pref_dns');
        s.anonymous = true;
        s.tab('dns', _('Preferred DNS'));
        s.tab('passwall', _('PassWall DNS'));

        // --- 域名列表 (DynamicList) ---
        o = s.taboption('dns', form.DynamicList, 'domain', _('Preferred Domains'));
        o.datatype = 'hostname';
        o.placeholder = 'example.com';

        // --- DNS 服务器 (Value, editable) ---
        o = s.taboption('dns', form.Value, 'dns_server', _('DNS Server'));
        o.default = '223.5.5.5';
        o.datatype = 'ipaddr';
        // 内置选项
        o.value('119.29.29.29', _('Tencent DNS (119.29.29.29)'));
        o.value('119.28.28.28', _('Tencent DNS (119.28.28.28)'));
        o.value('223.5.5.5', _('Alibaba DNS (223.5.5.5)'));
        o.value('223.6.6.6', _('Alibaba DNS (223.6.6.6)'));
        o.value('180.184.1.1', _('Volcengine DNS (180.184.1.1)'));
        o.value('180.184.2.2', _('Volcengine DNS (180.184.2.2)'));
        o.value('114.114.114.114', _('114 DNS (114.114.114.114)'));
        o.value('114.114.115.115', _('114 DNS (114.114.115.115)'));
        o.value('180.76.76.76', _('Baidu DNS (180.76.76.76)'));
        o.value('8.8.8.8', _('Google DNS (8.8.8.8)'));
        o.value('1.1.1.1', _('Cloudflare DNS (1.1.1.1)'));

        // --- 定时更新间隔 ---
        o = s.taboption('dns', form.ListValue, 'cron_interval', _('Auto Update Interval'));
        o.default = 'disabled';
        o.value('disabled', _('Disabled'));
        o.value('6h', _('Every 6 hours'));
        o.value('12h', _('Every 12 hours'));
        o.value('daily', _('Daily'));
        o.value('weekly', _('Weekly'));

        // --- 立即更新按钮 ---
        o = s.taboption('dns', form.Button, '_update', _('Update Now'));
        o.inputtitle = _('Execute');
        o.inputstyle = 'apply';
        o.onclick = function() {
            // 先保存当前表单配置到 UCI（确保脚本读取最新值）
            return m.save().then(function() {
                return fs.exec('/usr/share/pref_dns/pref_dns.sh', ['update']);
            }).then(function(res) {
                if (res.code === 0) {
                    var msg = (res.stdout || '').trim();
                    ui.addNotification(null, E('p', msg || _('Update completed')), 'info');
                    // 刷新 IP 显示
                    return updateIpDisplay();
                } else {
                    var err = (res.stderr || res.stdout || '').trim();
                    ui.addNotification(null, E('p', _('Update failed: ') + err), 'error');
                }
            }).catch(function(e) {
                ui.addNotification(null, E('p', _('Execution error: ') + e.message), 'error');
            });
        };

        // --- 当前 IP 显示区域 ---
        // 使用 form.DummyValue 来显示当前 mosdns cloudflare_ip
        o = s.taboption('dns', form.DummyValue, '_current_ips', _('Current Cloudflare IPs'));
        o.rawhtml = true;
        o.cfgvalue = function() {
            var ips = uci.get('mosdns', 'config', 'cloudflare_ip');
            if (!ips || !Array.isArray(ips) || ips.length === 0) {
                return '<em>' + _('No IPs configured') + '</em>';
            }
            return '<ul style="margin:0;padding-left:1.5em">' +
                ips.map(function(ip) { return '<li>' + ip + '</li>'; }).join('') +
                '</ul>';
        };

        // ========== Tab 2: PassWall DNS ==========
        // --- 写入 MosDNS 端口按钮 ---
        o = s.taboption('passwall', form.Button, '_pw_write', _('Write MosDNS Port'));
        o.inputtitle = _('Write to PassWall');
        o.inputstyle = 'apply';
        o.onclick = function() {
            return fs.exec('/usr/share/pref_dns/passwall.sh', ['write']).then(function(res) {
                if (res.code === 0) {
                    var msg = (res.stdout || '').trim();
                    ui.addNotification(null, E('p', msg || _('Write completed')), 'info');
                } else {
                    var err = (res.stderr || res.stdout || '').trim();
                    ui.addNotification(null, E('p', _('Write failed: ') + err), 'error');
                }
            }).catch(function(e) {
                ui.addNotification(null, E('p', _('Execution error: ') + e.message), 'error');
            });
        };

        // --- 恢复默认 DNS 按钮 ---
        o = s.taboption('passwall', form.Button, '_pw_restore', _('Restore Default DNS'));
        o.inputtitle = _('Restore Default');
        o.inputstyle = 'remove';
        o.onclick = function() {
            return fs.exec('/usr/share/pref_dns/passwall.sh', ['restore']).then(function(res) {
                if (res.code === 0) {
                    var msg = (res.stdout || '').trim();
                    ui.addNotification(null, E('p', msg || _('Restore completed')), 'info');
                } else {
                    var err = (res.stderr || res.stdout || '').trim();
                    ui.addNotification(null, E('p', _('Restore failed: ') + err), 'error');
                }
            }).catch(function(e) {
                ui.addNotification(null, E('p', _('Execution error: ') + e.message), 'error');
            });
        };

        return m.render();
    },

    // 重写 handleSaveApply 以同步 cron
    handleSaveApply: function(ev, mode) {
        return this.handleSave(ev).then(function() {
            // 同步 cron 定时任务
            return fs.exec('/usr/share/pref_dns/pref_dns.sh', ['cron']);
        }).then(function() {
            return uci.apply(mode);
        });
    }
});
