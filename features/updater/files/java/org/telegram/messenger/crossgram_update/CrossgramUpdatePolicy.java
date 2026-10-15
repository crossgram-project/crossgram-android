package org.telegram.messenger.crossgram_update;

import java.util.List;

/**
 * 不依赖 Android 环境的更新判定逻辑，独立出来以便在纯 JVM 中直接单测。
 */
public final class CrossgramUpdatePolicy {
    /** 发布清单中的单个 APK 产物条目。 */
    public static final class Asset {
        public final String client;
        public final String variant;
        public final String brand;
        public final String url;
        public final String sha256;

        public Asset(String client, String variant, String brand, String url, String sha256) {
            this.client = client;
            this.variant = variant;
            this.brand = brand;
            this.url = url;
            this.sha256 = sha256;
        }
    }

    public enum Decision {
        /** 当前已安装最新产物，或清单中无对应产物。 */
        UP_TO_DATE,
        /** 存在新版本，但自动检查已弹窗提示过或已被用户跳过。 */
        ALREADY_OFFERED,
        /** 需要弹出更新提示。 */
        OFFER,
    }

    private CrossgramUpdatePolicy() {
    }

    /** 匹配当前安装的清单产物条目，未命中时返回 null。 */
    public static Asset select(List<Asset> assets, String client, String variant, String brand) {
        for (Asset asset : assets) {
            if (asset == null || !client.equals(asset.client) || !variant.equals(asset.variant)
                    || !brand.equals(asset.brand)) {
                continue;
            }
            if (isEmpty(asset.url) || isEmpty(asset.sha256)) continue;
            return asset;
        }
        return null;
    }

    /**
     * 判断是否向用户提示更新。
     * 同一发布的全部产物共用顶层构建号 build。
     */
    public static Decision decide(Asset entry, int build, String installedSha256, boolean force,
                                  int promptedBuild, int skippedBuild) {
        if (entry == null || build <= 0) return Decision.UP_TO_DATE;
        if (installedSha256 != null && installedSha256.equalsIgnoreCase(entry.sha256)) {
            return Decision.UP_TO_DATE;
        }
        if (!force && (build == promptedBuild || build == skippedBuild)) return Decision.ALREADY_OFFERED;
        return Decision.OFFER;
    }

    /** 按设备支持的 ABI 优先级匹配发布变体。 */
    public static String variant(String[] supportedAbis) {
        if (supportedAbis != null) {
            for (String abi : supportedAbis) {
                if (abi == null) continue;
                if (abi.startsWith("arm64")) return "arm64";
                if (abi.startsWith("x86_64")) return "x86_64";
                if (abi.startsWith("armeabi")) return "arm";
                if (abi.startsWith("x86")) return "x86";
            }
        }
        return "arm64";
    }

    /** 提取品牌补丁追加在 applicationId 末尾的品牌名。 */
    public static String brand(String packageName, String marker) {
        final int index = packageName.lastIndexOf(marker);
        return index < 0 ? "" : packageName.substring(index + marker.length());
    }

    private static boolean isEmpty(String value) {
        return value == null || value.isEmpty();
    }
}
