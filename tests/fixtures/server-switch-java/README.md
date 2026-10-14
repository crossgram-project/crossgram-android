# server-switch dialog Java fixture

提供 `ServerSwitchDialogs` 依赖的最小 Android / Telegram 桩类与测试入口（`Harness.java`）。

Release 构建开启了 R8 优化资源压缩后，上游 `values/strings.xml` 里的共享字符串（`Cancel`/`OK` 等）
会被整表删除，此时 `Context.getString(...)` 抛 `Resources.NotFoundException`，一点开服务器列表就闪退。
`tests/server-switch-java.e2e.test.ts` 会把本目录与注入的 `ServerSwitchDialogs.java` 一起通过 `javac`
编译运行，用一张「只保留本特性字符串」的假资源表复现该场景，验证对话框只用自带字符串且缺失时只降级文案。
