#!/bin/sh

LOCK_DIR="/var/lock/pref_dns.lock"

log() {
    echo "$1"
}

acquire_lock() {
    if ! mkdir "$LOCK_DIR" 2>/dev/null; then
        log "ERROR: Another instance is running"
        exit 1
    fi
    trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT INT TERM
}

do_update() {
    acquire_lock

    dns_server=$(uci -q get pref_dns.config.dns_server)
    [ -z "$dns_server" ] && dns_server="223.5.5.5"

    domains=$(uci -q get pref_dns.config.domain)
    if [ -z "$domains" ]; then
        log "ERROR: No domains configured"
        exit 1
    fi

    if [ ! -f /etc/config/mosdns ]; then
        log "ERROR: mosdns not installed"
        exit 1
    fi

    all_ips=""
    for domain in $domains; do
        result=$(nslookup "$domain" "$dns_server" 2>/dev/null)
        ips=$(echo "$result" | sed -n '/^Name:/,$ p' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+')
        for ip in $ips; do
            all_ips="$all_ips $ip"
        done
    done

    all_ips=$(echo "$all_ips" | tr ' ' '\n' | sort -u | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$')

    if [ -z "$all_ips" ]; then
        log "WARNING: No IPs resolved, keeping old list"
        exit 0
    fi

    uci -q delete mosdns.config.cloudflare_ip
    for ip in $all_ips; do
        uci add_list mosdns.config.cloudflare_ip="$ip"
    done
    uci commit mosdns

    /etc/init.d/mosdns restart 2>/dev/null

    count=$(echo "$all_ips" | wc -l)
    log "OK: $count IPs updated"
}

do_cron() {
    interval=$(uci -q get pref_dns.config.cron_interval)
    [ -z "$interval" ] && interval="disabled"

    crontab_file="/etc/crontabs/root"
    [ -f "$crontab_file" ] || touch "$crontab_file"
    sed -i '/# pref_dns$/d' "$crontab_file"

    case "$interval" in
        6h)
            echo "0 */6 * * * /usr/share/pref_dns/pref_dns.sh update # pref_dns" >> "$crontab_file"
            ;;
        12h)
            echo "0 */12 * * * /usr/share/pref_dns/pref_dns.sh update # pref_dns" >> "$crontab_file"
            ;;
        daily)
            echo "0 3 * * * /usr/share/pref_dns/pref_dns.sh update # pref_dns" >> "$crontab_file"
            ;;
        weekly)
            echo "0 3 * * 0 /usr/share/pref_dns/pref_dns.sh update # pref_dns" >> "$crontab_file"
            ;;
    esac

    /etc/init.d/cron restart 2>/dev/null
}

case "$1" in
    update)
        do_update
        ;;
    cron)
        do_cron
        ;;
    *)
        echo "Usage: $0 {update|cron}"
        exit 1
        ;;
esac
