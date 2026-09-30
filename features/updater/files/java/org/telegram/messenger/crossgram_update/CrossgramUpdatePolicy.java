package org.telegram.messenger.crossgram_update;

import java.util.List;

/**
 * The Android-free decisions of the Crossgram updater, kept apart from the
 * runtime so they can be exercised on a plain JVM.
 */
public final class CrossgramUpdatePolicy {
    /** One APK of the release manifest. */
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
        /** The installed APK is the published one (or nothing is published for it). */
        UP_TO_DATE,
        /** A newer build exists, but this automatic check already offered or the user skipped it. */
        ALREADY_OFFERED,
        /** Show the update dialog. */
        OFFER,
    }

    private CrossgramUpdatePolicy() {
    }

    /** The manifest entry that describes this exact installation, or null. */
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
     * Whether to offer the build of the manifest. The build number lives on the
     * manifest itself: a release is one workflow run, and every asset in it
     * shares that number.
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

    /** The release variant for the ABIs the device supports, most preferred first. */
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

    /** The brand suffix the branding patch appended to the application id. */
    public static String brand(String packageName, String marker) {
        final int index = packageName.lastIndexOf(marker);
        return index < 0 ? "" : packageName.substring(index + marker.length());
    }

    private static boolean isEmpty(String value) {
        return value == null || value.isEmpty();
    }
}
