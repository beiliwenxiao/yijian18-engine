package com.sanguo.zhangjiao;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 游戏过程中保持屏幕常亮
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // 横屏全屏时让画面延伸进刘海/挖孔区域
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(params);
        }

        enterImmersiveMode();

        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) {
            // 页面加载前用黑底，避免 WebView 默认白底闪烁
            webView.setBackgroundColor(0xFF000000);
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            webView.setHorizontalScrollBarEnabled(false);
            webView.setVerticalScrollBarEnabled(false);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enterImmersiveMode();
        }
    }

    @Override
    public void onBackPressed() {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) {
            super.onBackPressed();
            return;
        }

        // 有浏览历史时优先回退页面
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }

        // 先通知页面（取消冒泡的 androidBack 事件表示页面已处理），未处理则退出应用
        String script =
                "(function(){try{var e=new CustomEvent('androidBack',{cancelable:true});"
                        + "window.dispatchEvent(e);return e.defaultPrevented?'1':'0';}"
                        + "catch(err){return '0';}})()";
        webView.evaluateJavascript(script, value -> {
            if (!"\"1\"".equals(value)) {
                finish();
            }
        });
    }

    private void enterImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }
}
