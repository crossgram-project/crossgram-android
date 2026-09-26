package org.json;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Enough of Android's org.json for the poke helper's feature payload. */
public class JSONObject {
    private final String text;

    public JSONObject(String text) {
        this.text = text;
    }

    public JSONObject optJSONObject(String name) {
        final Matcher matcher = Pattern.compile("\"" + name + "\"\\s*:\\s*\\{([^}]*)\\}").matcher(text);
        return matcher.find() ? new JSONObject(matcher.group(1)) : null;
    }

    public int optInt(String name, int fallback) {
        final Matcher matcher = Pattern.compile("\"" + name + "\"\\s*:\\s*(\\d+)").matcher(text);
        return matcher.find() ? Integer.parseInt(matcher.group(1)) : fallback;
    }

    public boolean has(String name) {
        return Pattern.compile("\"" + name + "\"\\s*:").matcher(text).find();
    }

    public boolean optBoolean(String name, boolean fallback) {
        final Matcher matcher = Pattern.compile("\"" + name + "\"\\s*:\\s*(true|false)").matcher(text);
        return matcher.find() ? Boolean.parseBoolean(matcher.group(1)) : fallback;
    }
}
