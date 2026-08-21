# 第 3 篇：插件配置

本篇让插件接收 `cordis.yml` 传入的配置，并由 Schemastery 在插件加载时完成默认值填充和校验。示例基于仓库官方教程[`docs/user/develop/basic/config.zh.md`](../../../docs/user/develop/basic/config.zh.md)。

## 前置条件

- 已完成[第 1 篇：第一个插件](01-first-plugin.md)。
- 已理解插件条目的 `config` 字段来自 Patch，而不是写死在插件源码中。
- 已知道 Profile、Bundle 和 Patch 的组合顺序，见[模块一](../module-1-global-and-cordis.md)。

## 1. 定义 Config 类型和 schema

插件需要同时导出 `Config` 类型和同名的 Schemastery schema：

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'my-plugin'

export interface Config {
  greeting: string
  maxRetries: number
  verbose?: boolean
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
  verbose: Schema.boolean().default(false),
})

export function apply(ctx: Context, config: Config) {
  console.log(config.greeting)
}
```

schema 是运行时校验器，也是默认值的拥有者；`Config` 接口提供编译期类型。不要只导出一个普通对象作为 `Config`，它不具备 Cordis 需要的 Standard Schema 接口。

## 2. 在 Patch 中传入配置

在插件条目的 `config` 下写用户取值：

```yaml
- insert:
    - id: hello
      name: '/absolute/path/to/deepseek-harness/scratch-plugin/src/my-plugin.ts'
      config:
        greeting: 'Hi there'
        maxRetries: 5
```

未提供的字段使用 schema 默认值。修改 `greeting` 后重新启动 Overlay，插件应打印 `Hi there`。

## 3. 让错误尽早失败

把可以表达的约束写进 schema：

```ts
export interface Config {
  apiKey: string
  timeout: number
  mode: 'fast' | 'accurate'
}

export const Config = Schema.object({
  apiKey: Schema.string().required(),
  timeout: Schema.number().default(30000),
  mode: Schema.union(['fast', 'accurate']).default('fast'),
})
```

配置不合法时，插件应在加载阶段失败并给出配置错误，而不是以部分可用状态继续运行。部署之间可能变化的值应成为配置字段；固定的协议常量、安全不变量和外部规范不需要为了可配置而抽出。

## 4. 配置和生命周期

配置改变会触发对应插件实例的替换：旧实例卸载并运行其 Effect 清理，新实例用新配置重新激活。因此配置驱动的注册必须属于插件生命周期，不能把旧实例的监听器、工具或外部资源留在全局状态中。

## 5. 最小验证

先查看最终配置：

```sh
pnpm dsh --profile web --dump-config --patch ./scratch-plugin/cordis.yml
```

再启动 Web profile，并检查插件日志或工具行为是否体现配置值：

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

最后把 `maxRetries` 改成字符串等无效值，确认加载失败而不是静默采用一个未声明的默认值。配置的完整语法和 HMR 行为见[`docs/user/develop/basic/config.zh.md`](../../../docs/user/develop/basic/config.zh.md)。

## 本篇小结

- `Config` 接口负责类型，Schemastery schema 负责运行时校验和默认值。
- Patch 的 `config` 字段是用户覆盖配置的入口。
- 可表达的约束应在加载时校验；错误配置应尽早失败。
- 配置替换依赖 Effect 清理旧实例，插件不得泄漏旧注册或资源。

下一篇：[第 4 篇：打包与安装插件](04-package-install.md)。
