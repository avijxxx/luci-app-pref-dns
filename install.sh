#!/bin/sh

set -e

RED='\033[1;31m'
GREEN='\033[1;32m'
RESET='\033[0m'

msg_red()   { printf "${RED}%s${RESET}\n" "$*"; }
msg_green() { printf "${GREEN}%s${RESET}\n" "$*"; }

REPO="avijxxx/luci-app-pref-dns"

# Parse gh_proxy from $1
gh_proxy=""
if [ -n "$1" ]; then
    case "$1" in
        gh_proxy=*)
            gh_proxy="${1#gh_proxy=}"
            [ -n "$gh_proxy" ] && case "$gh_proxy" in
                */) : ;;
                *) gh_proxy="$gh_proxy/" ;;
            esac
            ;;
    esac
fi

# Check OpenWrt
if [ ! -f /etc/openwrt_release ]; then
    msg_red "This script only runs on OpenWrt."
    exit 1
fi

# Load OpenWrt release info
. /etc/openwrt_release
REL_MM=$(printf '%s\n' "${DISTRIB_RELEASE:-}" | sed -n 's/^\([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\1.\2/p')

# Check LuCI version (need 21.02+)
if [ ! -d "/usr/share/luci/menu.d" ]; then
    msg_red "LuCI version not supported. Minimum: openwrt-21.02."
    exit 1
fi

# Detect package manager
if [ -x "/usr/bin/apk" ]; then
    PKG_MANAGER="apk"
    PKG_OPT="add --allow-untrusted"
    PKG_EXT="apk"
elif command -v opkg >/dev/null 2>&1; then
    PKG_MANAGER="opkg"
    PKG_OPT="install --force-downgrade"
    PKG_EXT="ipk"
else
    msg_red "No supported package manager found."
    exit 1
fi

# Fix missing /var/lock directory (common issue on some custom firmwares)
if [ "$PKG_MANAGER" = "opkg" ] && [ ! -d "/var/lock" ]; then
    msg_green "Creating missing /var/lock directory..."
    mkdir -p "/var/lock"
    chmod 1777 "/var/lock"
fi

select_asset_prefix() {
    local major minor rel_num

    if [ "$PKG_EXT" = "apk" ]; then
        printf '%s\n' "25.12+"
        return
    fi

    if [ -z "$REL_MM" ]; then
        printf '%s\n' "23.05-24.10"
        return
    fi

    major=${REL_MM%.*}
    minor=${REL_MM#*.}
    rel_num=$((major * 100 + minor))

    if [ "$rel_num" -ge 2305 ]; then
        printf '%s\n' "23.05-24.10"
    else
        printf '%s\n' "22.03-"
    fi
}

ASSET_PREFIX=$(select_asset_prefix)
ASSET_PREFIX_URL=$(printf '%s\n' "$ASSET_PREFIX" | sed 's/+/%2B/g')
msg_green "Detected OpenWrt ${DISTRIB_RELEASE:-unknown}, asset channel: $ASSET_PREFIX"

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

# Get latest release metadata
msg_green "Fetching latest release metadata..."
API_URL="https://api.github.com/repos/$REPO/releases/latest"
if ! RELEASE_JSON="$(curl -fsSL "$API_URL")"; then
    msg_red "Failed to fetch latest release metadata."
    exit 1
fi

TAG=$(printf '%s\n' "$RELEASE_JSON" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
if [ -z "$TAG" ]; then
    msg_red "Failed to parse latest release tag."
    exit 1
fi
msg_green "Latest version: $TAG"

find_asset_url() {
    local keyword="$1"
    local candidates preferred

    candidates=$(printf '%s\n' "$RELEASE_JSON" \
        | grep '"browser_download_url"' \
        | grep -F "_$keyword" \
        | grep -F ".$PKG_EXT\"" \
        | sed -E 's/.*"([^"]+)".*/\1/')

    preferred=$(printf '%s\n' "$candidates" | grep -F "/${ASSET_PREFIX_URL}_" | head -n 1)

    if [ -n "$preferred" ]; then
        printf '%s\n' "$preferred"
        return
    fi

    printf '%s\n' "$candidates" | head -n 1
}

download_pkg_by_keyword() {
    local keyword="$1"
    local url name final_url

    url="$(find_asset_url "$keyword")"
    if [ -z "$url" ]; then
        msg_red "No release asset found for: $keyword (.$PKG_EXT)"
        return 1
    fi

    if ! printf '%s\n' "$url" | grep -Fq "/${ASSET_PREFIX_URL}_"; then
        msg_red "No $ASSET_PREFIX asset found for $keyword, fallback to nearest package."
    fi

    name="${url##*/}"
    final_url="$url"
    [ -n "$gh_proxy" ] && final_url="${gh_proxy}${url}"

    msg_green "Downloading $name ..."
    if ! curl --connect-timeout 5 -m 120 -kLo "$TEMP_DIR/$name" "$final_url"; then
        msg_red "Download $name failed."
        return 1
    fi
}

# Download packages from release assets returned by API
download_pkg_by_keyword "luci-app-pref-dns"

# i18n package is optional
download_pkg_by_keyword "luci-i18n-pref-dns-zh-cn" || msg_red "luci-i18n-pref-dns-zh-cn not found, skip."

# Install packages
msg_green "Installing packages..."
installed=0
for pkg in "$TEMP_DIR"/*."$PKG_EXT"; do
    [ -f "$pkg" ] || continue
    $PKG_MANAGER $PKG_OPT "$pkg"
    installed=1
done

if [ "$installed" -eq 0 ]; then
    msg_red "No package downloaded to install."
    exit 1
fi

if [ -f "/usr/share/pref_dns/pref_dns.sh" ] && [ ! -x "/usr/share/pref_dns/pref_dns.sh" ]; then
    msg_green "Fixing backend script permission..."
    chmod 0755 "/usr/share/pref_dns/pref_dns.sh"
fi

if [ -x "/etc/init.d/rpcd" ]; then
    /etc/init.d/rpcd restart >/dev/null 2>&1 || true
fi

rm -rf /tmp/luci-*
msg_green "Done! Please refresh your LuCI page."
