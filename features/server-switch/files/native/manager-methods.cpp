void ConnectionsManager::setServerConfig(std::string configId, std::string rsaKey,
                                         bool specialConfigEnabled) {
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
