package org.telegram.tgnet;

public class TLRPC {
    public static class TL_error {
        public int code;
        public String text;

        public TL_error(int code, String text) {
            this.code = code;
            this.text = text;
        }
    }

    public static class InputPeer extends TLObject {
        public String marker;

        public InputPeer(String marker) {
            this.marker = marker;
        }

        @Override
        public void serializeToStream(OutputSerializedData stream) {
            stream.written.add("peer:" + marker);
        }
    }

    public static class InputUser extends TLObject {
        public String marker;

        public InputUser(String marker) {
            this.marker = marker;
        }

        @Override
        public void serializeToStream(OutputSerializedData stream) {
            stream.written.add("user:" + marker);
        }
    }

    public static class TL_inputPeerEmpty extends InputPeer {
        public TL_inputPeerEmpty() {
            super("empty");
        }
    }

    public static class User {
        public long id;

        public User(long id) {
            this.id = id;
        }
    }

    public static class Bool extends TLObject {
        public static Bool TLdeserialize(InputSerializedData stream, int constructor, boolean exception) {
            return new Bool();
        }

        @Override
        public void serializeToStream(OutputSerializedData stream) {
        }
    }

    public static class TL_dataJSON extends TLObject {
        public String data;

        public TL_dataJSON(String data) {
            this.data = data;
        }

        public static TL_dataJSON TLdeserialize(InputSerializedData stream, int constructor, boolean exception) {
            return null;
        }

        @Override
        public void serializeToStream(OutputSerializedData stream) {
        }
    }
}
