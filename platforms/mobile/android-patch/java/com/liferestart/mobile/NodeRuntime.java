package com.liferestart.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * APK 内置 Node 运行时的启动器（Step 25 延伸）。
 *
 * 做什么：
 *   1. 把 assets/nodejs-project（main.js + proxy.js）复制到 filesDir —— APK 是压缩包，
 *      Node 没法直接从 assets 里 require，必须先落盘；
 *      proxy.js 是 scripts/build-node-project.js 用 esbuild 打好的 game-engine AI 代理（CJS 单文件）；
 *   2. 在独立线程里调用 node::Start(["node", &lt;dir&gt;/main.js, &lt;port&gt;])（JNI 见 cpp/nodejs_jni.cpp）；
 *   3. Node 侧监听 127.0.0.1:8787，WebView 里的前端直连它做 AI 请求（provider 转发 + SSE 流式）。
 *
 * 为什么能复用桌面/Web 的代理实现：三端跑的是同一个 createProxyHandler，
 * 移动端只是换了「谁来执行它」——桌面是 Electron 主进程、Web 是内嵌 http 服务、移动是内置 Node 运行时。
 *
 * 前端一致性：PROXY_PORT 必须与 packages/frontend/src/utils/mod-runtime.js 的 NATIVE_AI_PROXY_PORT、
 * nodejs/main.js 的默认端口一致（有测试解析这三个文件比对，改一处漏一处会红）。
 */
public final class NodeRuntime {
    /** logcat 标签（与 cpp/nodejs_jni.cpp 的 LOG_TAG 一致，过滤用）。 */
    public static final String TAG = "LiferestartNode";
    /** AI 代理端口。 */
    public static final int PROXY_PORT = 8787;

    /** assets 里的 Node 工程目录（prepare-android.js 复制进去）。 */
    private static final String ASSET_DIR = "nodejs-project";
    /** 入口脚本（nodejs/main.js，见 platforms/mobile/nodejs/）。 */
    private static final String ENTRY_SCRIPT = "main.js";
    /** SharedPreferences 名字。 */
    private static final String PREFS = "LIFERESTART_NODE_PREFS";
    /** 记录上次复制时的 APK 最后更新时间。 */
    private static final String PREF_APK_TIME = "apk_last_update_time";

    /** 只启动一次（nodejs-mobile 不支持重启运行时；同一 App 进程内也只能有一个实例）。 */
    private static boolean started = false;

    // libnode.so 提供 node::Start；nodejs_jni.so 是我们的 JNI 壳（依赖 libnode，先加载它）。
    static {
        System.loadLibrary("node");
        System.loadLibrary("nodejs_jni");
    }

    /** JNI 实现见 cpp/nodejs_jni.cpp（符号名与包名/类名/方法名绑定，改名要一起改）。 */
    private static native int startNodeWithArguments(String[] arguments);

    private NodeRuntime() {
        // 工具类，不实例化。
    }

    /**
     * 幂等启动 Node 运行时（由 MainActivity.onCreate 调用）。
     *
     * @param context 任意 Context（内部取 ApplicationContext，避免持有 Activity）
     */
    public static synchronized void startIfNeeded(Context context) {
        if (started) {
            Log.i(TAG, "Node 运行时已启动，跳过");
            return;
        }
        started = true;
        final Context appContext = context.getApplicationContext();
        // 复制 assets 与 node::Start 都会阻塞（后者一直阻塞到运行时结束），必须放到后台线程。
        Thread thread = new Thread(() -> {
            try {
                String nodeDir = appContext.getFilesDir().getAbsolutePath() + "/" + ASSET_DIR;
                // 只在「APK 更新过」或「上次复制不完整」时重新复制：这几 MB 没必要每次冷启动都搬。
                if (wasApkUpdated(appContext) || !new File(nodeDir, ENTRY_SCRIPT).exists()) {
                    deleteRecursively(new File(nodeDir));
                    copyAssetFolder(appContext, ASSET_DIR, nodeDir);
                    saveLastUpdateTime(appContext);
                    Log.i(TAG, "Node 工程已复制到 " + nodeDir);
                } else {
                    Log.i(TAG, "Node 工程已是最新，直接启动：" + nodeDir);
                }
                String scriptPath = nodeDir + "/" + ENTRY_SCRIPT;
                Log.i(TAG, "启动 Node：" + scriptPath + "（port=" + PROXY_PORT + "）");
                // 进入 Node（本调用不会返回，除非运行时退出/出错）；Node 的 stdout/stderr 已接到 logcat。
                int code = startNodeWithArguments(new String[] { "node", scriptPath, String.valueOf(PROXY_PORT) });
                Log.i(TAG, "Node 已退出，code=" + code);
            } catch (Throwable error) {
                // 绝不让启动失败拖垮 App：前端会表现为「AI 不可用」，原因在 logcat 里。
                Log.e(TAG, "Node 启动失败", error);
            }
        }, "liferestart-node");
        thread.setDaemon(true);
        thread.start();
    }

    /** APK 是否在上次复制之后更新过。 */
    private static boolean wasApkUpdated(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long previous = prefs.getLong(PREF_APK_TIME, 0L);
        return lastUpdateTime(context) != previous;
    }

    /** 记录本次复制对应的 APK 时间戳。 */
    private static void saveLastUpdateTime(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putLong(PREF_APK_TIME, lastUpdateTime(context)).apply();
    }

    /** 读取 APK 的 lastUpdateTime（取不到时用 1，保证与初始值 0 不同 → 会复制）。 */
    private static long lastUpdateTime(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return info.lastUpdateTime;
        } catch (PackageManager.NameNotFoundException error) {
            Log.w(TAG, "读取 APK 时间戳失败", error);
            return 1L;
        }
    }

    /** 递归删除（不存在也算成功）。 */
    private static boolean deleteRecursively(File file) {
        if (file == null || !file.exists()) {
            return true;
        }
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteRecursively(child);
            }
        }
        return file.delete();
    }

    /**
     * 把 assets 下的目录整棵复制到目标路径。
     *
     * 注意：AssetManager 无法区分「空目录」和「文件」，所以用 list() 长度为 0 判断是文件。
     */
    private static boolean copyAssetFolder(Context context, String fromAssetPath, String toPath) {
        try {
            String[] children = context.getAssets().list(fromAssetPath);
            boolean ok = true;
            if (children == null || children.length == 0) {
                // 叶子节点：是文件。
                return copyAssetFile(context, fromAssetPath, toPath);
            }
            File dir = new File(toPath);
            if (!dir.exists() && !dir.mkdirs()) {
                Log.w(TAG, "创建目录失败：" + toPath);
            }
            for (String child : children) {
                ok &= copyAssetFolder(context, fromAssetPath + "/" + child, toPath + "/" + child);
            }
            return ok;
        } catch (IOException error) {
            Log.e(TAG, "复制 assets 目录失败：" + fromAssetPath, error);
            return false;
        }
    }

    /** 复制单个 asset 文件。 */
    private static boolean copyAssetFile(Context context, String fromAssetPath, String toPath) {
        try (InputStream in = context.getAssets().open(fromAssetPath)) {
            File target = new File(toPath);
            File parent = target.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                Log.w(TAG, "创建目录失败：" + parent.getAbsolutePath());
            }
            try (OutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
                out.flush();
            }
            return true;
        } catch (IOException error) {
            Log.e(TAG, "复制 asset 失败：" + fromAssetPath + " → " + toPath, error);
            return false;
        }
    }
}
