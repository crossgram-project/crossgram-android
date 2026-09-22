package org.telegram.tgnet;

public abstract class TLObject {
    public abstract void serializeToStream(OutputSerializedData stream);

    public TLObject deserializeResponse(InputSerializedData stream, int constructor, boolean exception) {
        return null;
    }
}
