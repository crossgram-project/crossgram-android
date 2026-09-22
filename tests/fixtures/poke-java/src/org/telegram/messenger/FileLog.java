package org.telegram.messenger;

public class FileLog {
    public static void d(String message) {
        System.out.println("log: " + message);
    }

    public static void e(Throwable error) {
        System.out.println("error: " + error);
    }
}
