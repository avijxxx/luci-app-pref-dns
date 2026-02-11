#!/bin/sh

# Atomic lock mechanism
acquire_lock() {
    if ! mkdir /var/lock/pref_dns.lock 2>/dev/null; then
        echo "ERROR: Another instance is running"
        exit 1
    fi
    trap 'rmdir /var/lock/pref_dns.lock 2>/dev/null' EXIT INT TERM
}

# Check if passwall is running and restart if needed
restart_passwall_if_running() {
    if /etc/init.d/passwall status 2>/dev/null | grep -q "running"; then
        /etc/init.d/passwall restart 2>/dev/null
    fi
}

# Write mosdns port to passwall remote DNS
do_write() {
    # Check mosdns config exists
    [ -f /etc/config/mosdns ] || { echo "ERROR: mosdns not installed"; exit 1; }

    # Check passwall config exists
    [ -f /etc/config/passwall ] || { echo "ERROR: passwall not installed"; exit 1; }

    # Read mosdns listen port
    listen_port=$(uci -q get mosdns.config.listen_port)
    [ -z "$listen_port" ] && { echo "ERROR: mosdns listen_port not configured"; exit 1; }

    # Write to passwall remote DNS (format: IP#PORT)
    uci set passwall.@global[0].remote_dns="127.0.0.1#${listen_port}"
    uci commit passwall

    # Conditional restart
    restart_passwall_if_running

    echo "OK: passwall remote_dns set to 127.0.0.1#${listen_port}"
}

# Restore passwall remote DNS to default
do_restore() {
    # Check passwall config exists
    [ -f /etc/config/passwall ] || { echo "ERROR: passwall not installed"; exit 1; }

    # Restore to default value
    uci set passwall.@global[0].remote_dns="1.1.1.1"
    uci commit passwall

    # Conditional restart
    restart_passwall_if_running

    echo "OK: passwall remote_dns restored to 1.1.1.1"
}

# Main entry
acquire_lock

case "$1" in
    write)
        do_write
        ;;
    restore)
        do_restore
        ;;
    *)
        echo "Usage: $0 {write|restore}"
        exit 1
        ;;
esac
