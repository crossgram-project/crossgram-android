void ConnectionsManager::setServerConfig(std::string configId, std::string rsaKey,
                                         bool specialConfigEnabled, bool resetDatacenters) {
    if (!resetDatacenters) {
        customServerId = std::move(configId);
        customServerRsaKey = std::move(rsaKey);
        enableSpecialConfig = specialConfigEnabled;
        return;
    }
    scheduleTask([this, configId = std::move(configId), rsaKey = std::move(rsaKey),
                  specialConfigEnabled] {
        if (customServerId == configId && customServerRsaKey == rsaKey &&
            enableSpecialConfig == specialConfigEnabled) {
            return;
        }
        customServerId = configId;
        customServerRsaKey = rsaKey;
        enableSpecialConfig = specialConfigEnabled;
        currentDatacenterId = 2;
        Handshake::cleanupServerKeys();
        datacenters.clear();
        initDatacenters();
        saveConfig();
    });
}
const std::string &ConnectionsManager::getCustomServerRsaKey() const {
    return customServerRsaKey;
}
