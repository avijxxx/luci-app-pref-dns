#!/bin/sh
# luci-app-pref-dns backend script
# Subcommands: resolve, commit_and_restart

LOCK_FILE="/var/lock/luci-pref-dns.lock"
TIMEOUT=10

json_output() {
	local code="$1" msg="$2" data="$3"
	echo "{\"code\":${code},\"message\":\"${msg}\"${data:+,${data}}}"
}

check_service_running() {
	local svc="$1"
	[ ! -f "/etc/init.d/$svc" ] && echo "not_installed" && return
	/etc/init.d/"$svc" running >/dev/null 2>&1 && echo "running" || echo "stopped"
}

# --- resolve <domain> <dns_server> ---
do_resolve() {
	local domain="$1" dns_server="$2"
	[ -z "$domain" ] || [ -z "$dns_server" ] && {
		json_output 1 "missing_params"
		return 1
	}

	# Input validation: reject - prefix (option injection)
	case "$domain" in -*) json_output 1 "invalid_domain"; return 1;; esac
	case "$dns_server" in -*) json_output 1 "invalid_dns_server"; return 1;; esac

	# FQDN format check (max 253 chars, valid hostname chars)
	[ "${#domain}" -gt 253 ] && { json_output 1 "domain_too_long"; return 1; }
	echo "$domain" | grep -qE '^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$' || {
		json_output 1 "invalid_domain"
		return 1
	}

	# DNS server must be a valid IPv4 address
	echo "$dns_server" | grep -qE '^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$' || {
		json_output 1 "invalid_dns_server"
		return 1
	}

	local tmpfile
	tmpfile=$(mktemp /tmp/pref_dns.XXXXXX) || {
		json_output 1 "mktemp_failed"
		return 1
	}
	trap "rm -f '$tmpfile'" EXIT

	nslookup "$domain" "$dns_server" > "$tmpfile" 2>&1 &
	local pid=$!

	local elapsed=0
	while [ "$elapsed" -lt "$TIMEOUT" ]; do
		kill -0 "$pid" 2>/dev/null || break
		sleep 1
		elapsed=$((elapsed + 1))
	done

	if kill -0 "$pid" 2>/dev/null; then
		kill "$pid" 2>/dev/null
		json_output 1 "timeout"
		return 1
	fi

	local ips="" ip_list="" count=0 in_answer=0

	while IFS= read -r line; do
		case "$line" in
			Name:*|name:*)
				in_answer=1
				;;
			Address*:*)
				if [ "$in_answer" -eq 1 ]; then
					local addr
					addr=$(echo "$line" | sed -E 's/^Address[^:]*:[[:space:]]*//')
					addr=$(echo "$addr" | sed 's/#.*//' | tr -d ' ')
					# IPv4 only — skip IPv6 addresses
					echo "$addr" | grep -qE '^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$' && {
						ips="${ips:+$ips }$addr"
						ip_list="${ip_list:+$ip_list,}\"$addr\""
						count=$((count + 1))
					}
				fi
				;;
		esac
	done < "$tmpfile"

	[ "$count" -eq 0 ] && {
		json_output 1 "no_ip_found"
		return 1
	}

	flock -x 200 200>"$LOCK_FILE"
	uci -q delete mosdns.config.cloudflare_ip
	for ip in $ips; do
		uci add_list mosdns.config.cloudflare_ip="$ip"
	done
	uci set mosdns.config.cloudflare='1'
	uci commit mosdns || {
		flock -u 200
		json_output 1 "uci_commit_failed"
		return 1
	}
	flock -u 200

	local mosdns_status restart_result="saved_only"
	mosdns_status=$(check_service_running "mosdns")
	[ "$mosdns_status" = "running" ] && {
		if /etc/init.d/mosdns restart >/dev/null 2>&1; then
			restart_result="restarted"
		else
			restart_result="restart_failed"
		fi
	}
	[ "$mosdns_status" = "not_installed" ] && restart_result="not_installed"

	uci set pref_dns.config.last_resolve_time="$(date '+%Y-%m-%d %H:%M:%S')"
	uci commit pref_dns 2>/dev/null

	json_output 0 "ok" "\"ips\":[${ip_list}],\"count\":${count},\"restart\":\"${restart_result}\""
}

# --- commit_and_restart ---
do_commit_and_restart() {
	local mosdns_commit="false" passwall_commit="false"

	flock -x 200 200>"$LOCK_FILE"
	uci changes mosdns 2>/dev/null | grep -q . && {
		if uci commit mosdns; then
			mosdns_commit="true"
		else
			flock -u 200
			json_output 1 "uci_commit_mosdns_failed"
			return 1
		fi
	}
	uci changes passwall 2>/dev/null | grep -q . && {
		if uci commit passwall; then
			passwall_commit="true"
		else
			flock -u 200
			json_output 1 "uci_commit_passwall_failed"
			return 1
		fi
	}
	uci commit pref_dns 2>/dev/null
	flock -u 200

	local mosdns_restart="saved_only" passwall_restart="saved_only" status

	status=$(check_service_running "mosdns")
	if [ "$status" = "not_installed" ]; then
		mosdns_restart="not_installed"
	elif [ "$status" = "running" ] && [ "$mosdns_commit" = "true" ]; then
		if /etc/init.d/mosdns restart >/dev/null 2>&1; then
			mosdns_restart="restarted"
		else
			mosdns_restart="restart_failed"
		fi
	fi

	status=$(check_service_running "passwall")
	if [ "$status" = "not_installed" ]; then
		passwall_restart="not_installed"
	elif [ "$status" = "running" ] && [ "$passwall_commit" = "true" ]; then
		if /etc/init.d/passwall restart >/dev/null 2>&1; then
			passwall_restart="restarted"
		else
			passwall_restart="restart_failed"
		fi
	fi

	echo "{\"code\":0,\"commit\":{\"mosdns\":${mosdns_commit},\"passwall\":${passwall_commit}},\"restart\":{\"mosdns\":\"${mosdns_restart}\",\"passwall\":\"${passwall_restart}\"}}"
}

CRON_MARKER="# pref-dns-auto"
CRON_FILE="/etc/crontabs/root"

# --- cron enable|disable ---
do_cron() {
	local action="$1"
	case "$action" in
		enable)
			local domain dns_server cron_expr
			domain=$(uci -q get pref_dns.config.domain)
			dns_server=$(uci -q get pref_dns.config.dns_server)
			cron_expr=$(uci -q get pref_dns.config.cron_expression)

			[ -z "$domain" ] && {
				logger -t pref-dns "cron enable skipped: domain is empty"
				json_output 1 "empty_domain"
				return 1
			}
			[ -z "$cron_expr" ] && {
				json_output 1 "empty_cron_expression"
				return 1
			}

			flock -x 200 200>"$LOCK_FILE"
			[ -f "$CRON_FILE" ] && sed -i "/$CRON_MARKER/d" "$CRON_FILE"
			echo "$cron_expr /usr/share/pref_dns/pref_dns.sh resolve $domain $dns_server $CRON_MARKER" >> "$CRON_FILE"
			flock -u 200

			/etc/init.d/cron restart >/dev/null 2>&1
			json_output 0 "cron_enabled"
			;;
		disable)
			flock -x 200 200>"$LOCK_FILE"
			[ -f "$CRON_FILE" ] && sed -i "/$CRON_MARKER/d" "$CRON_FILE"
			flock -u 200

			/etc/init.d/cron restart >/dev/null 2>&1
			json_output 0 "cron_disabled"
			;;
		*)
			json_output 1 "unknown_cron_action"
			return 1
			;;
	esac
}

# --- main ---
case "$1" in
	resolve)
		do_resolve "$2" "$3"
		;;
	commit_and_restart)
		do_commit_and_restart
		;;
	cron)
		do_cron "$2"
		;;
	*)
		json_output 1 "unknown_command"
		exit 1
		;;
esac
