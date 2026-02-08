# Copyright (C) 2024-2026 avijxxx
# This is free software, licensed under the GPL-3.0 License.

include $(TOPDIR)/rules.mk

PKG_VERSION:=1.0
PKG_RELEASE:=4

LUCI_TITLE:=LuCI Support for Preferred DNS
LUCI_PKGARCH:=all
LUCI_DEPENDS:=+luci-base

PKG_LICENSE:=GPL-3.0-only
PKG_MAINTAINER:=avijxxx

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
