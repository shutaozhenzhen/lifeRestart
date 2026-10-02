package com.liferestart.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * App 主 Activity（由 prepare-android.js 覆盖 Capacitor 模板生成的同名文件）。
 *
 * 与模板的差别只有一处：在 super.onCreate() 之后拉起**内置 Node 运行时**（AI 代理）。
 * 放在这里而不是 Service 里，是因为代理只在 App 前台时需要；
 * 真要做后台常驻再改成前台 Service（那时还要处理通知与厂商后台限制）。
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 幂等：重复调用会被 NodeRuntime 忽略（nodejs-mobile 不支持重启运行时）。
        NodeRuntime.startIfNeeded(getApplicationContext());
    }
}
