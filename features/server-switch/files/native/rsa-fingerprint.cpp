static bool getRsaPublicKeyFingerprint(const std::string &publicKey, uint64_t &fingerprint) {
    BIO *keyBio = BIO_new_mem_buf(publicKey.data(), (int) publicKey.size());
    if (keyBio == nullptr) {
        return false;
    }
    RSA *rsaKey = PEM_read_bio_RSAPublicKey(keyBio, nullptr, nullptr, nullptr);
    BIO_free(keyBio);
    if (rsaKey == nullptr) {
        return false;
    }

    const BIGNUM *n = nullptr;
    const BIGNUM *e = nullptr;
    RSA_get0_key(rsaKey, &n, &e, nullptr);
    if (n == nullptr || e == nullptr) {
        RSA_free(rsaKey);
        return false;
    }

    int nBytes = BN_num_bytes(n);
    int eBytes = BN_num_bytes(e);
    std::string nString(nBytes, 0);
    std::string eString(eBytes, 0);
    BN_bn2bin(n, reinterpret_cast<uint8_t *>(&nString[0]));
    BN_bn2bin(e, reinterpret_cast<uint8_t *>(&eString[0]));

    NativeByteBuffer *buffer = BuffersStorage::getInstance().getFreeBuffer(nBytes + eBytes + 16);
    buffer->writeString(nString);
    buffer->writeString(eString);
    uint8_t hash[SHA_DIGEST_LENGTH];
    SHA1(buffer->bytes(), buffer->position(), hash);
    buffer->reuse();
    RSA_free(rsaKey);

    fingerprint = ((uint64_t) hash[19]) << 56 |
                  ((uint64_t) hash[18]) << 48 |
                  ((uint64_t) hash[17]) << 40 |
                  ((uint64_t) hash[16]) << 32 |
                  ((uint64_t) hash[15]) << 24 |
                  ((uint64_t) hash[14]) << 16 |
                  ((uint64_t) hash[13]) << 8 |
                  ((uint64_t) hash[12]);
    return true;
}
