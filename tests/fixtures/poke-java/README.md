# Poke Java 测试桩

提供 `CrossgramPoke` 依赖的最小 Android / Telegram 桩类与测试入口（`Harness.java`）。`tests/poke-java.e2e.test.ts` 会将本目录与注入的 `CrossgramPoke.java` 一起通过 `javac` 编译运行，验证能力探测、菜单项生成、连戳请求序列化与官方服务器降级行为。
