package org.telegram.tgnet;

import java.util.ArrayList;
import java.util.List;

public class OutputSerializedData {
    public final List<String> written = new ArrayList<>();

    public void writeInt32(int value) {
        written.add("int:" + value);
    }

    public void writeInt64(long value) {
        written.add("long:" + value);
    }

    public String joined() {
        return String.join(",", written);
    }
}
