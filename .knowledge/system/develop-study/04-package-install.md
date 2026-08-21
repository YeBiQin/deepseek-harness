# 第 4 篇：打包与安装插件

前几篇通过 `--patch` Overlay 加载本地源码。本篇把插件放进一个可分发的 Bundle，再使用 `dsh plugin` 将它安装到 profile。完整命令和边界见[`docs/user/develop/basic/publish.zh.md`](../../../docs/user/develop/basic/publish.zh.md)。

## 前置条件

- 已完成[第 3 篇：插件配置](03-plugin-config.md)。
- 已安装可用的 `dsh` CLI；在源码仓库中练习时可将 `dsh` 替换为 `pnpm dsh`。
- 已理解 Patch 按层组合，后应用的层可以按 `id` 覆盖前面的配置行。

## 1. 区分 Bundle 和 profile

两者都由 `package.json` 描述，但作用不同：

| 概念 | `package.json` 字段 | 回答的问题 |
|---|---|---|
| Bundle | `dsh.bundle` | 这个包贡献哪一层 Cordis Patch？ |
| Profile | `dsh.profile` | 这次启动按什么顺序组合哪些 Bundle？ |

Bundle 是可编写、可分发的配置层；profile 是用户实际启动的一套组合。一个包不要同时把自己当作这两个概念来使用。

## 2. 创建最小 Bundle

目录可以是：

```text
hello-plugin/
├── package.json
├── cordis.patch.yml
└── index.js
```

`package.json` 声明 Bundle Patch：

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

插件入口可以是：

```js
export const name = 'hello-plugin'

export function apply() {
  console.log('[hello-plugin] plugin loaded!')
}
```

Bundle Patch 通过包名引用入口：

```yaml
- insert:
    - id: hello
      name: dsh-hello-plugin
```

Bundle Patch 和临时 Overlay 都是 YAML Patch 数组；区别是 Bundle 的插件行使用可由 Node 解析的包名，而不是依赖本机目录的相对路径。

## 3. 安装到 profile

在包含 `hello-plugin` 目录的路径执行：

```sh
dsh plugin --profile demo add ./hello-plugin
```

首次使用时，CLI 会初始化 profile，并把该包添加到 profile 的依赖和 `dsh.profile.bundles` 列表。先查看组合结果：

```sh
dsh --profile demo --dump-config
```

确认配置中出现 `dsh-hello-plugin` 层后再启动：

```sh
dsh --profile demo
```

移除时使用：

```sh
dsh plugin --profile demo remove dsh-hello-plugin
```

## 4. 记住 Patch 层顺序

当前 profile 的配置从空 entry list 开始，按以下顺序叠加：

1. `dsh.profile.bundles` 中 Bundle 的 Patch，按列表顺序。
2. profile 自己的 `cordis.patch.yml`。
3. Harness Home 的 `cordis.patch.yml`。
4. 命令行按顺序传入的 `--patch` Overlay。

后应用的层可以按 `id` 覆盖前面的行；覆盖会替换整行的 `config`，不是深度合并字段。因此覆盖一个已有条目时，必须重述该行所需的完整配置。

## 5. 从 Git 安装时的构建边界

Git 安装取得的是源码，不会自动拥有仓库中的构建产物。TypeScript Bundle 需要提供自包含的 `prepare` 构建脚本，或者直接分发已构建的 npm 包、tarball。pnpm 可能要求用户显式允许依赖的构建脚本；这等价于允许该包在安装时于用户机器执行代码，只应对可信源码授权，并尽量锁定 commit。

如果 Bundle 只是被其他插件 import 的普通库，而不是用户要启用的配置层，不要声明 `dsh.bundle`；它应作为普通依赖安装。

## 最小验证

从低成本到高成本依次验证：

```sh
dsh --profile demo --dump-config
dsh --profile demo
dsh plugin --profile demo remove dsh-hello-plugin
```

第一条命令确认 Bundle 层已经组合；第二条确认插件在真实 profile 中激活；第三条确认安装管理可以移除依赖和对应配置层。具体构建、Git 安装和 profile 文件格式以[`docs/user/develop/basic/publish.zh.md`](../../../docs/user/develop/basic/publish.zh.md)为准。

## 本篇小结

- Bundle 贡献一层 Patch，profile 决定按什么顺序组合 Bundle。
- `dsh plugin add` 同时更新 profile 依赖和 Bundle 列表。
- `--dump-config` 是启动前检查实际组合结果的入口。
- Patch 覆盖按 `id` 替换整行配置，不能假设字段会深度合并。
- Git 安装必须处理构建产物和安装期脚本授权问题。
