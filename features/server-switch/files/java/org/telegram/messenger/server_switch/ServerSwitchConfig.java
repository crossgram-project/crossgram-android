package org.telegram.messenger.server_switch;

import android.util.AtomicFile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.telegram.messenger.ApplicationLoader;
import org.telegram.messenger.FileLog;
import org.telegram.tgnet.ConnectionsManager;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public final class ServerSwitchConfig {
    private static final int FILE_VERSION = 1;
    private static final Object LOCK = new Object();

    private static Store cachedStore;

    private ServerSwitchConfig() {
    }

    public static final class Dc {
        public final int id;
        public final String ip;
        public final int port;

        private Dc(int id, String ip, int port) {
            this.id = id;
            this.ip = ip;
            this.port = port;
        }

        private static Dc fromJson(JSONObject json) throws JSONException {
            return new Dc(json.getInt("id"), json.getString("ip").trim(), json.getInt("port"));
        }

        private JSONObject toJson() throws JSONException {
            return new JSONObject().put("id", id).put("ip", ip).put("port", port);
        }
    }

    public static final class Server {
        public final String id;
        public final String name;
        public final boolean enableSpecialConfig;
        public final String host;
        public final int port;
        public final String rsaKey;
        public final List<Dc> dcs;

        private Server(String id, String name, boolean enableSpecialConfig, String host, int port,
                       String rsaKey, List<Dc> dcs) {
            this.id = id;
            this.name = name;
            this.enableSpecialConfig = enableSpecialConfig;
            this.host = host;
            this.port = port;
            this.rsaKey = rsaKey;
            this.dcs = dcs;
        }

        public static Server parseUserInput(String value) throws JSONException {
            return fromJson(new JSONObject(value), UUID.randomUUID().toString());
        }

        private static Server fromJson(JSONObject json, String fallbackId) throws JSONException {
            String id = json.optString("id", fallbackId);
            String name = json.getString("name").trim();
            boolean enableSpecialConfig = json.optBoolean("enable_special_config", true);
            String host = json.getString("host").trim();
            int port = json.getInt("port");
            String rsaKey = json.getString("rsa_key").trim();
            JSONArray dcArray = json.optJSONArray("dcs");
            ArrayList<Dc> dcs = new ArrayList<>();
            Set<Integer> configuredDcIds = new HashSet<>();
            if (dcArray != null) {
                for (int i = 0; i < dcArray.length(); i++) {
                    Dc dc = Dc.fromJson(dcArray.getJSONObject(i));
                    dcs.add(dc);
                    configuredDcIds.add(dc.id);
                }
            }
            for (int dcId = 1; dcId <= 5; dcId++) {
                if (!configuredDcIds.contains(dcId)) {
                    dcs.add(new Dc(dcId, host, port));
                }
            }
            Server server = new Server(id, name, enableSpecialConfig, host, port, rsaKey, dcs);
            server.validate();
            return server;
        }

        private void validate() throws JSONException {
            if (id.isEmpty() || name.isEmpty()) {
                throw new JSONException("name must not be empty");
            }
            if (host.isEmpty() || !isValidPort(port)) {
                throw new JSONException("host or port is invalid");
            }
            if (!rsaKey.startsWith("-----BEGIN RSA PUBLIC KEY-----")
                    || !rsaKey.endsWith("-----END RSA PUBLIC KEY-----")) {
                throw new JSONException("rsa_key must be a PEM encoded RSA public key");
            }
            Set<Integer> ids = new HashSet<>();
            for (Dc dc : dcs) {
                if (dc.id <= 0 || dc.ip.isEmpty() || !isValidPort(dc.port) || !ids.add(dc.id)) {
                    throw new JSONException("dcs contains an invalid or duplicate entry");
                }
            }
        }

        private JSONObject toJson() throws JSONException {
            JSONArray dcArray = new JSONArray();
            for (Dc dc : dcs) {
                dcArray.put(dc.toJson());
            }
            return new JSONObject()
                    .put("id", id)
                    .put("name", name)
                    .put("enable_special_config", enableSpecialConfig)
                    .put("host", host)
                    .put("port", port)
                    .put("rsa_key", rsaKey)
                    .put("dcs", dcArray);
        }
    }

    private static final class Store {
        final ArrayList<Server> servers = new ArrayList<>();
        final JSONObject accountSelections = new JSONObject();

        static Store fromJson(JSONObject json) throws JSONException {
            Store store = new Store();
            JSONArray array = json.optJSONArray("servers");
            if (array != null) {
                for (int i = 0; i < array.length(); i++) {
                    JSONObject item = array.getJSONObject(i);
                    store.servers.add(Server.fromJson(item, UUID.randomUUID().toString()));
                }
            }
            JSONObject selections = json.optJSONObject("account_selections");
            if (selections != null) {
                JSONArray names = selections.names();
                if (names != null) {
                    for (int i = 0; i < names.length(); i++) {
                        String name = names.getString(i);
                        store.accountSelections.put(name, selections.getString(name));
                    }
                }
            }
            return store;
        }

        JSONObject toJson() throws JSONException {
            JSONArray array = new JSONArray();
            for (Server server : servers) {
                array.put(server.toJson());
            }
            return new JSONObject()
                    .put("version", FILE_VERSION)
                    .put("servers", array)
                    .put("account_selections", accountSelections);
        }
    }

    public static List<Server> getServers() {
        synchronized (LOCK) {
            return new ArrayList<>(getStore().servers);
        }
    }

    public static String getSelectedServerId(int account) {
        synchronized (LOCK) {
            return getStore().accountSelections.optString(Integer.toString(account), "");
        }
    }

    public static boolean isSpecialConfigEnabled(int account) {
        synchronized (LOCK) {
            Server server = findSelectedServer(getStore(), account);
            return server == null || server.enableSpecialConfig;
        }
    }

    public static void selectOfficial(int account) throws Exception {
        synchronized (LOCK) {
            Store store = getStore();
            store.accountSelections.remove(Integer.toString(account));
            save(store);
            applyLocked(store, account, true);
        }
    }

    public static void select(int account, String serverId) throws Exception {
        synchronized (LOCK) {
            Store store = getStore();
            if (findServer(store, serverId) == null) {
                throw new IllegalArgumentException("Unknown server configuration");
            }
            store.accountSelections.put(Integer.toString(account), serverId);
            save(store);
            applyLocked(store, account, true);
        }
    }

    public static Server addAndSelect(int account, String json) throws Exception {
        Server server = Server.parseUserInput(json);
        synchronized (LOCK) {
            Store store = getStore();
            store.servers.add(server);
            store.accountSelections.put(Integer.toString(account), server.id);
            save(store);
            applyLocked(store, account, true);
        }
        return server;
    }

    public static void applyForInitialization(int account) {
        synchronized (LOCK) {
            applyLocked(getStore(), account, false);
        }
    }

    private static void applyLocked(Store store, int account, boolean resetDatacenters) {
        Server server = findSelectedServer(store, account);
        if (server == null) {
            ConnectionsManager.native_setServerConfig(account, "", "", true, resetDatacenters);
            return;
        }
        ConnectionsManager.native_setServerConfig(account, server.id, server.rsaKey,
                server.enableSpecialConfig, resetDatacenters);
        for (Dc dc : server.dcs) {
            ConnectionsManager.native_applyDatacenterAddress(account, dc.id, dc.ip, dc.port);
        }
    }

    private static Store getStore() {
        if (cachedStore != null) {
            return cachedStore;
        }
        AtomicFile file = getFile();
        try (FileInputStream stream = file.openRead()) {
            byte[] bytes = new byte[(int) stream.getChannel().size()];
            int offset = 0;
            while (offset < bytes.length) {
                int read = stream.read(bytes, offset, bytes.length - offset);
                if (read < 0) break;
                offset += read;
            }
            cachedStore = Store.fromJson(new JSONObject(new String(bytes, 0, offset,
                    StandardCharsets.UTF_8)));
        } catch (Exception e) {
            cachedStore = new Store();
            if (file.getBaseFile().exists()) {
                FileLog.e(e);
            }
        }
        return cachedStore;
    }

    private static void save(Store store) throws Exception {
        AtomicFile file = getFile();
        File parent = file.getBaseFile().getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IllegalStateException("Cannot create server-switch storage directory");
        }
        FileOutputStream stream = null;
        try {
            stream = file.startWrite();
            stream.write(store.toJson().toString(2).getBytes(StandardCharsets.UTF_8));
            file.finishWrite(stream);
        } catch (Exception e) {
            if (stream != null) file.failWrite(stream);
            throw e;
        }
    }

    private static AtomicFile getFile() {
        File directory = new File(ApplicationLoader.getFilesDirFixed(), "server-switch");
        return new AtomicFile(new File(directory, "servers.json"));
    }

    private static Server findSelectedServer(Store store, int account) {
        return findServer(store, store.accountSelections.optString(Integer.toString(account), ""));
    }

    private static Server findServer(Store store, String id) {
        if (id == null || id.isEmpty()) return null;
        for (Server server : store.servers) {
            if (id.equals(server.id)) return server;
        }
        return null;
    }

    private static boolean isValidPort(int port) {
        return port > 0 && port <= 65535;
    }
}
