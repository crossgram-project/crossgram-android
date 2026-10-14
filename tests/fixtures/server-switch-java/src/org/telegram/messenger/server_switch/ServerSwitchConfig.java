package org.telegram.messenger.server_switch;

import java.util.ArrayList;
import java.util.List;

/** Storage stub: the dialog harness only needs the server list and the current selection. */
public final class ServerSwitchConfig {
    public static final class Server {
        public final String id;
        public final String name;

        public Server(String id, String name) {
            this.id = id;
            this.name = name;
        }
    }

    public static final List<Server> servers = new ArrayList<>();
    public static String selectedId = "";

    private ServerSwitchConfig() {
    }

    public static List<Server> getServers() {
        return new ArrayList<>(servers);
    }

    public static String getSelectedServerId(int account) {
        return selectedId;
    }

    public static void selectOfficial(int account) throws Exception {
        selectedId = "";
    }

    public static void select(int account, String serverId) throws Exception {
        selectedId = serverId;
    }

    public static Server addAndSelect(int account, String json) throws Exception {
        throw new IllegalStateException("no configuration was provided");
    }
}
