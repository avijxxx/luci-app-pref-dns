# luci-app-pref-dns - AI 开发上下文

> 自动生成于 2026-02-08 | OpenWrt LuCI 应用

## 项目概述

**luci-app-pref-dns** 是一个 OpenWrt LuCI Web 应用，提供 Cloudflare IP 优选和 PassWall DNS 集中管理功能。

### 核心功能
- **Cloudflare IP 优选**: 通过国内 DNS 解析指定域名，获取最优 IPv4 地址并写入 MosDNS 配置
- **定时解析**: 支持 Cron 定时自动解析，保持 IP 列表新鲜
- **PassWall DNS 管理**: 集中管理 PassWall 的 DNS 分流、远程 DNS、FakeDNS 等设置
- **服务状态监控**: 实时显示 MosDNS / PassWall 运行状态

### 技术栈
- **前端**: LuCI JavaScript (ES5+), LuCI Form API
- **后端**: Shell Script (POSIX sh)
- **配置**: UCI (Unified Configuration Interface)
- **构建**: OpenWrt Makefile, GitHub Actions
- **目标平台**: OpenWrt 21.02+ (x86_64)

---

## 项目结构

```
luci-app-pref-dns/
├── Makefile                          # OpenWrt 包构建配置
├── README.md                         # 项目说明文档
├── install.sh                        # 一键安装脚本
│
├── .github/workflows/
│   └── build.yml                     # CI/CD 自动编译配置
│
├── root/                             # 系统文件根目录
│   ├── etc/config/
│   │   └── pref_dns                  # UCI 配置文件
│   └── usr/share/
│       ├── luci/menu.d/
│       │   └── luci-app-pref-dns.json  # LuCI 菜单入口
│       ├── rpcd/acl.d/
│       │   └── luci-app-pref-dns.json  # RPC 访问控制列表
│       └── pref_dns/
│           └── pref_dns.sh           # 后端业务逻辑脚本
│
├── htdocs/                           # Web 静态资源
│   └── luci-static/resources/view/pref_dns/
│       └── basic.js                  # 前端 UI 主视图
│
└── po/                               # 国际化翻译文件
    ├── templates/                    # POT 模板
    └── zh_Hans/                      # 简体中文翻译
```

---

## 核心模块说明

### 1. 前端 UI (`htdocs/luci-static/resources/view/pref_dns/basic.js`)

**技术特点:**
- 使用 LuCI 现代化 JavaScript View API
- 基于 Promise 的异步服务状态检测
- 实时轮询 (Poll) 更新服务状态
- RPC 调用后端脚本执行业务逻辑

**关键功能:**
- 服务状态监控 (MosDNS, PassWall, Cron)
- Cloudflare IP 解析触发
- PassWall DNS 配置管理
- Cron 定时任务配置

**依赖模块:**
```javascript
'require form';      // LuCI 表单 API
'require fs';        // 文件系统操作
'require poll';      // 轮询机制
'require rpc';       // RPC 调用
'require uci';       // UCI 配置读写
'require ui';        // UI 组件
'require view';      // 视图基类
```

### 2. 后端脚本 (`root/usr/share/pref_dns/pref_dns.sh`)

**技术特点:**
- POSIX Shell 兼容 (适配 BusyBox ash)
- 文件锁机制防止并发冲突
- 严格的输入验证 (防止命令注入)
- JSON 格式输出

**子命令:**
- `resolve <domain> <dns_server>` - 执行 DNS 解析并写入 MosDNS 配置
- `commit_and_restart` - 提交 UCI 配置并重启相关服务

**安全措施:**
- FQDN 格式验证 (RFC 1035)
- IPv4 地址格式验证
- 拒绝 `-` 前缀参数 (防止选项注入)
- 文件锁超时机制

### 3. UCI 配置 (`root/etc/config/pref_dns`)

**配置项:**
```uci
config pref_dns 'config'
    option domain ''                  # 目标域名 (如 speed.cloudflare.com)
    option dns_server '119.29.29.29'  # 国内 DNS 服务器
    option last_resolve_time ''       # 上次解析时间戳
    option cron_enabled '0'           # 是否启用定时任务
    option cron_expression ''         # Cron 表达式
```

### 4. LuCI 菜单配置 (`root/usr/share/luci/menu.d/luci-app-pref-dns.json`)

**路径:** `admin/services/pref_dns`
**标题:** 优选DNS
**排序:** 89 (在服务菜单中的位置)
**视图:** `pref_dns/basic`

### 5. RPC ACL (`root/usr/share/rpcd/acl.d/luci-app-pref-dns.json`)

定义前端可调用的后端权限：
- UCI 配置读写权限
- 文件系统访问权限
- 服务状态查询权限

---

## 构建与发布

### Makefile 关键配置

```makefile
PKG_NAME:=luci-app-pref-dns
PKG_VERSION:=1.0
PKG_RELEASE:=2

LUCI_TITLE:=LuCI Support for Preferred DNS
LUCI_PKGARCH:=all
LUCI_DEPENDS:=+luci-base
```

**安装规则:**
- UCI 配置文件 → `/etc/config/pref_dns`
- 后端脚本 → `/usr/share/pref_dns/pref_dns.sh`
- LuCI 菜单 → `/usr/share/luci/menu.d/`
- RPC ACL → `/usr/share/rpcd/acl.d/`
- 前端 JS → `/www/luci-static/resources/view/pref_dns/`

### CI/CD 流程 (`.github/workflows/build.yml`)

**触发条件:**
- Push 到 main 分支
- 监控文件变更: `Makefile`, `root/**`, `htdocs/**`, `po/**`

**构建矩阵:**
| OpenWrt 版本 | SDK 版本 | 标签 |
|-------------|---------|------|
| 21.02.7 | GCC 8.4.0 | 22.03- |
| 24.10.5 | GCC 13.3.0 | 23.05-24.10 |
| Snapshots | GCC 14.3.0 | 25.12+ |

**发布策略:**
- 自动检测版本号变更 (`PKG_VERSION-PKG_RELEASE`)
- 生成 GitHub Release
- 上传编译后的 IPK 包

---

## 依赖关系

### 必需依赖
- `luci-base` - LuCI 核心框架

### 可选依赖
- `mosdns` - Cloudflare IP 优选功能所需
- `passwall` - PassWall DNS 管理功能所需
- `cron` - 定时解析功能所需

---

## 开发指南

### 本地开发环境

1. **克隆仓库**
```bash
git clone https://github.com/avijxxx/luci-app-pref-dns.git
cd luci-app-pref-dns
```

2. **在 OpenWrt SDK 中编译**
```bash
# 将项目复制到 SDK 的 package 目录
cp -r luci-app-pref-dns /path/to/openwrt-sdk/package/

# 编译
cd /path/to/openwrt-sdk
make package/luci-app-pref-dns/{clean,compile} V=s
```

3. **测试安装**
```bash
# 生成的 IPK 位于
ls bin/packages/*/luci/luci-app-pref-dns*.ipk

# 上传到路由器并安装
scp bin/packages/*/luci/luci-app-pref-dns*.ipk root@192.168.1.1:/tmp/
ssh root@192.168.1.1 "opkg install /tmp/luci-app-pref-dns*.ipk"
```

### 代码修改注意事项

**前端 (basic.js):**
- 遵循 LuCI JavaScript 编码规范
- 使用 `L.resolveDefault()` 处理异步错误
- 避免使用 ES6+ 语法 (兼容性考虑)
- 使用 `_()` 函数包裹所有用户可见文本 (国际化)

**后端 (pref_dns.sh):**
- 严格遵循 POSIX Shell 语法 (不使用 Bash 特性)
- 所有外部输入必须验证
- 使用 `json_output()` 统一输出格式
- 避免使用管道和子 shell (性能考虑)

**UCI 配置:**
- 新增配置项需同步更新前端表单
- 保持向后兼容性
- 提供合理的默认值

### 调试技巧

**前端调试:**
```javascript
// 在浏览器控制台查看 LuCI 对象
console.log(L);

// 查看 UCI 配置
uci.load('pref_dns').then(function() {
    console.log(uci.get('pref_dns', 'config'));
});
```

**后端调试:**
```bash
# 直接调用脚本测试
/usr/share/pref_dns/pref_dns.sh resolve "speed.cloudflare.com" "119.29.29.29"

# 查看 UCI 配置
uci show pref_dns

# 查看日志
logread | grep pref_dns
```

---

## 常见问题

### Q1: 编译失败 "No rule to make target"
**原因:** Makefile 不完整或 luci.mk 未正确引入
**解决:** 确保 `include $(TOPDIR)/feeds/luci/luci.mk` 在 `install` 定义之前

### Q2: 前端页面空白
**原因:** JavaScript 语法错误或模块加载失败
**解决:** 检查浏览器控制台错误，确认所有 `'require'` 模块存在

### Q3: RPC 调用失败
**原因:** ACL 权限不足或 rpcd 未重启
**解决:** 检查 `luci-app-pref-dns.json` 权限配置，重启 rpcd 服务

### Q4: UCI 配置不生效
**原因:** 未执行 `uci commit` 或服务未重启
**解决:** 确保调用 `commit_and_restart` 子命令

---

## 许可证

GPL-3.0 License

---

## 维护者

- GitHub: [@avijxxx](https://github.com/avijxxx)
- 仓库: https://github.com/avijxxx/luci-app-pref-dns

---

## 更新日志

### v1.0-2 (2026-02-08)
- 修复 Makefile 缺失文件安装规则
- 添加 CI 自动触发机制
- 完善构建流程

### v1.0-1 (Initial Release)
- 实现 Cloudflare IP 优选功能
- 实现 PassWall DNS 管理功能
- 支持 Cron 定时解析
- 服务状态实时监控
