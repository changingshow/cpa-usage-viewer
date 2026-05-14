# Usage Latest Dashboard

一个纯前端的 usage 数据看板。项目不再包含 Go 后端、数据库、Redis 消费、登录鉴权或同步任务；页面只读取静态文件 `usage-latest.json` 并展示其中已有的数据。

## 目录结构

```text
web/
  public/
    usage-latest.json      # 页面读取的静态数据文件
    model-prices.json      # 模型价格配置文件
  src/
    components/            # 看板组件
    lib/api.ts             # 静态 JSON 数据适配器
    pages/UsagePage.tsx    # 主页面
  package.json
  vite.config.js
```

## 环境要求

- Node.js 22.12+，或 Node.js 20.19+
- npm

当前本机如果使用 Node.js 22.9.0，Vite 可以构建，但会提示版本低于推荐要求。建议升级到 22.12 或更高版本。

## 本地运行

```powershell
npm --prefix ./web ci
npm --prefix ./web run dev -- --host=127.0.0.1
```

打开：

```text
http://127.0.0.1:5173/
```

不需要启动后端，也不需要登录密码。

## 数据文件

默认读取：

```text
web/public/usage-latest.json
```

替换数据时，直接覆盖这个文件，然后刷新页面即可。

数据文件需要至少包含：

```json
{
  "version": 1,
  "exported_at": "2026-05-13T11:09:48.3963841Z",
  "usage": {
    "total_requests": 3260,
    "success_count": 2918,
    "failure_count": 342,
    "total_tokens": 392393473,
    "apis": {},
    "requests_by_day": {},
    "requests_by_hour": {},
    "tokens_by_day": {},
    "tokens_by_hour": {}
  }
}
```

首页、趋势图、事件列表和分析页主要依赖 `usage.apis.*.models.*.details`。如果某些页面需要的数据不在 JSON 里，当前会显示空数据或默认状态。

## 定价文件

模型价格默认读取：

```text
web/public/model-prices.json
```

页面不会把定价保存到浏览器 `localStorage`，也不会写回这个文件。新增或修改价格时，直接编辑 `model-prices.json`，刷新页面后生效。

格式：

```json
{
  "gpt-5.5": {
    "prompt": 5,
    "completion": 30,
    "cache": 0.5
  },
  "gpt-5.4": {
    "prompt": 2.5,
    "completion": 15,
    "cache": 0.25
  }
}
```

## 可选配置

默认 usage JSON 地址是 `usage-latest.json`，也就是 Vite `public` 目录里的文件。需要改成其它 URL 时，可以在启动或构建前设置：

```powershell
$env:VITE_USAGE_JSON_URL="/my-usage.json"
npm --prefix ./web run dev -- --host=127.0.0.1
```

对应文件必须能被浏览器直接访问。

模型价格配置也可以改成其它 URL：

```powershell
$env:VITE_MODEL_PRICES_URL="/model-prices.json"
npm --prefix ./web run dev -- --host=127.0.0.1
```

## 构建静态文件

```powershell
npm --prefix ./web run build
```

构建结果在：

```text
web/dist/
```

可以把 `web/dist` 部署到任意静态服务器。静态服务器必须同时提供构建产物中的 `usage-latest.json` 和 `model-prices.json`。

本地预览构建结果：

```powershell
npm --prefix ./web run preview -- --host=127.0.0.1
```

## 校验

```powershell
npm --prefix ./web run typecheck
npm --prefix ./web run build
```

可选：

```powershell
npm --prefix ./web run test
npm --prefix ./web run lint
```

## 已移除的后端能力

- Go HTTP 服务
- SQLite 数据库
- Redis usage 队列消费
- CPA metadata 同步
- 数据库备份和日志轮转
- 登录保护和 session
- Docker/systemd/Release 工作流

现在的应用只负责读取静态 JSON 并展示。数据生成、同步和导出需要在项目外部完成。

## 项目来源与修改说明

本项目基于 [Willxup/cpa-usage-keeper](https://github.com/Willxup/cpa-usage-keeper) 修改而来，不是原项目的官方版本。当前版本是一个纯前端展示版本。感谢原作者的开源精神和原项目提供的基础实现。

当前版本已经移除了原项目中的全部后端相关内容，包括 Go 服务、数据库、Redis 队列、定时任务、登录接口、部署脚本以及后端 API 依赖。项目只保留前端页面和数据展示逻辑，通过读取静态 JSON 文件来展示使用量、请求事件、模型统计和价格信息。

也就是说，这个版本不再负责采集、同步、存储或生成数据；它只负责把已经准备好的文件内容展示出来。默认读取的文件包括：

- `web/public/usage-latest.json`：使用量和请求事件数据
- `web/public/model-prices.json`：模型价格配置

如果后续需要更新展示数据，只需要替换对应 JSON 文件，或者通过环境变量把前端指向其它可被浏览器访问的 JSON 地址。
