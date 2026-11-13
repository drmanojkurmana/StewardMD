package in.stewardmd.app;

import android.content.Context;
import android.graphics.Rect;
import android.util.AttributeSet;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import com.getcapacitor.CapacitorWebView;

/**
 * The app's web view (res/layout/capacitor_bridge_layout_main.xml). Owner 2026-11-13: selecting lesson or Knowledge
 * Library text must offer only the app's own highlight palette (text-highlight.js), never the system selection bar
 * (Copy, Share, Select all, Web search, Translate), which made copying the content one tap away. Selection itself
 * stays, so highlighting works. iOS twin: SmdWebView in ios/App/App/MainViewController.swift.
 *
 * Chromium starts a floating action mode for every selection and fills its menu in onCreate/onPrepareActionMode. The
 * callback is wrapped: after Chromium fills the menu, a read-only selection gets an empty one, so no bar shows. The
 * mode itself must still start (Chromium clears the selection when it cannot). In something the user types into
 * (a note, a search box) the menu has Cut or Paste and is left alone.
 */
public class SmdWebView extends CapacitorWebView {
    public SmdWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback) {
        return super.startActionMode(wrap(callback));
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        return super.startActionMode(wrap(callback), type);
    }

    static boolean editable(Menu menu) {
        return menu.findItem(android.R.id.cut) != null || menu.findItem(android.R.id.paste) != null;
    }

    private static ActionMode.Callback wrap(final ActionMode.Callback cb) {
        if (cb == null) return null;
        return new ActionMode.Callback2() {
            @Override
            public boolean onCreateActionMode(ActionMode mode, Menu menu) {
                boolean ok = cb.onCreateActionMode(mode, menu);
                if (!editable(menu)) menu.clear();
                return ok;
            }

            @Override
            public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
                boolean changed = cb.onPrepareActionMode(mode, menu);
                if (!editable(menu) && menu.size() > 0) { menu.clear(); return true; }
                return changed;
            }

            @Override
            public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
                return cb.onActionItemClicked(mode, item);
            }

            @Override
            public void onDestroyActionMode(ActionMode mode) {
                cb.onDestroyActionMode(mode);
            }

            @Override
            public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
                if (cb instanceof ActionMode.Callback2) ((ActionMode.Callback2) cb).onGetContentRect(mode, view, outRect);
                else super.onGetContentRect(mode, view, outRect);
            }
        };
    }
}
