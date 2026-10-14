package android.content;

import android.content.res.Resources;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * A context backed by a fake resource table: the harness decides which string ids the
 * packaged APK still has, so a shrunken release build can be reproduced exactly.
 */
public class Context {
    public static final String CLIPBOARD_SERVICE = "clipboard";

    /** Ids the packaged table can resolve; anything else throws like the real Resources. */
    public static final Map<Integer, String> strings = new HashMap<>();
    /** Every id this context was asked for, so the harness can prove what the dialog reads. */
    public static final Set<Integer> requested = new HashSet<>();
    /** Set to true to simulate a build that kept none of the feature's own strings either. */
    public static boolean failAll;

    public String getString(int resId) {
        requested.add(resId);
        String value = failAll ? null : strings.get(resId);
        if (value == null) {
            throw new Resources.NotFoundException("String resource ID #0x" + Integer.toHexString(resId));
        }
        return value;
    }

    public Object getSystemService(String name) {
        return null;
    }
}
