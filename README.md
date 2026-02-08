# luci-app-pref-dns

OpenWrt LuCI 应用 — MosDNS Cloudflare IP 优选 & PassWall DNS 管理

## 功能

- **Cloudflare IP 优选**: 通过国内 DNS 解析指定域名，获取最优 IPv4 地址写入 MosDNS 配置
- **定时解析**: 支持 Cron 定时自动解析，保持 IP 列表新鲜
- **PassWall DNS 管理**: 集中管理 PassWall 的 DNS 分流、远程 DNS、FakeDNS 等设置
- **服务状态监控**: 实时显示 MosDNS / PassWall 运行状态

## 安装

### 方式 1: 一键安装（推荐）

SSH 登录路由器后执行：

```sh
curl -sL https://raw.githubusercontent.com/avijxxx/luci-app-pref-dns/main/install.sh | sh
```

国内网络可使用代理加速：

```sh
curl -sL https://raw.githubusercontent.com/avijxxx/luci-app-pref-dns/main/install.sh | sh -s gh_proxy=https://gh-proxy.com/
```

### 方式 2: 手动安装

从 [Releases](../../releases/latest) 下载对应版本的 ipk/apk 文件，上传到路由器后执行：

```sh
# ipk (opkg)
opkg install luci-app-pref-dns_*.ipk
opkg install luci-i18n-pref-dns-zh-cn_*.ipk

# apk
apk add luci-app-pref-dns_*.apk
apk add luci-i18n-pref-dns-zh-cn_*.apk
```

### 方式 3: 从源码编译

```sh
# 在 OpenWrt SDK 或源码目录下
git clone https://github.com/avijxxx/luci-app-pref-dns.git package/luci-app-pref-dns
make package/luci-app-pref-dns/{clean,compile} V=s
```

## 依赖

- `luci-base` (OpenWrt 21.02+)
- MosDNS（Cloudflare IP 优选功能）
- PassWall（DNS 管理功能，可选）
- Cron 服务（定时解析功能，可选）

## 截图

进入 LuCI → 服务 → 首选 DNS 即可使用。

## 许可证

GPL-3.0
