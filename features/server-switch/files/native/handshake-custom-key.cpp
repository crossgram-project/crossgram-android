            const std::string &customKey = ConnectionsManager::getInstance(
                    currentDatacenter->instanceNum).getCustomServerRsaKey();
            if (!customKey.empty()) {
                uint64_t customFingerprint = 0;
                if (getRsaPublicKeyFingerprint(customKey, customFingerprint)) {
                    for (uint32_t a = 0; a < count1; a++) {
                        if ((uint64_t) result->server_public_key_fingerprints[a] == customFingerprint) {
                            keyFingerprint = result->server_public_key_fingerprints[a];
                            key = customKey;
                            break;
                        }
                    }
                }
            }
