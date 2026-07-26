void setServerConfig(JNIEnv *env, jclass c, jint instanceNum, jstring configId, jstring rsaKey,
                     jboolean enableSpecialConfig, jboolean resetDatacenters) {
    const char *configIdStr = env->GetStringUTFChars(configId, 0);
    const char *rsaKeyStr = env->GetStringUTFChars(rsaKey, 0);
    ConnectionsManager::getInstance(instanceNum).setServerConfig(
            std::string(configIdStr), std::string(rsaKeyStr), enableSpecialConfig,
            resetDatacenters);
    if (configIdStr != 0) {
        env->ReleaseStringUTFChars(configId, configIdStr);
    }
    if (rsaKeyStr != 0) {
        env->ReleaseStringUTFChars(rsaKey, rsaKeyStr);
    }
}
