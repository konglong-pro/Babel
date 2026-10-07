using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace BabelLauncher
{
    // Exercises real WebView2 controls with temporary local fixture pages. No
    // keyboard input is sent to the operating system or another application.
    public static class DesktopSmoke
    {
        private static readonly List<string> passed = new List<string>();

        public static string Run(Type hostType, string origin, string profile, Action<Window> configureWindow)
        {
            passed.Clear();
            var window = new Window {
                Width = 900, Height = 650, Left = -32000, Top = -32000,
                ShowActivated = false, ShowInTaskbar = false, WindowStyle = WindowStyle.None, Opacity = 0,
                Title = "Babel isolated desktop smoke test"
            };
            configureWindow(window);
            int configuredPopups = 0;
            var root = new DockPanel();
            var tabs = new StackPanel { Orientation = Orientation.Horizontal };
            var status = new TextBlock();
            var surface = new Grid();
            var home = new Grid();
            DockPanel.SetDock(tabs, Dock.Top);
            DockPanel.SetDock(status, Dock.Bottom);
            root.Children.Add(tabs);
            root.Children.Add(status);
            surface.Children.Add(home);
            root.Children.Add(surface);
            window.Content = root;
            object host = Activator.CreateInstance(hostType, window, surface, home, tabs, status, profile, new[] { origin });
            var fixtureLogo = new DrawingImage();
            hostType.GetProperty("ResolveAppLogo").SetValue(host, new Func<string, ImageSource>(id => fixtureLogo));
            hostType.GetProperty("ConfigureWindow").SetValue(host, new Action<Window>(popup => {
                Check(window.Dispatcher.CheckAccess(), "Popup identity callback left the WPF UI thread.");
                Check(popup.Icon != null && popup.Icon == window.Icon, "Popup did not inherit the Babel window icon.");
                Check(popup.Owner == null && popup.ShowInTaskbar && popup.ShowActivated && popup.Opacity == 1,
                    "Detached windows must have independent visibility and taskbar controls.");
                configureWindow(popup);
                // Keep this fixture isolated after checking the production defaults.
                popup.WindowStartupLocation = WindowStartupLocation.Manual;
                popup.Left = -32000;
                popup.Top = -32000;
                popup.ShowInTaskbar = false;
                popup.ShowActivated = false;
                popup.Opacity = 0;
                configuredPopups++;
            }));
            Exception failure = null;
            bool verificationStarted = false;
            window.Loaded += async (sender, args) => {
                if (verificationStarted) return;
                verificationStarted = true;
                try {
                    Task verification = VerifyAsync(hostType, host, origin, tabs, fixtureLogo, window);
                    if (await Task.WhenAny(verification, Task.Delay(45000)) != verification)
                        throw new TimeoutException("Desktop smoke test exceeded 45 seconds.");
                    await verification;
                    Check(configuredPopups == 4, "The PowerShell identity callback did not configure all detached note windows.");
                } catch (Exception error) { failure = error; }
                finally {
                    ((IDisposable)host).Dispose();
                    window.Close();
                }
            };
            // A detached window must survive hiding the APP, so keep the
            // fixture dispatcher running until Closed instead of a modal hide.
            var frame = new System.Windows.Threading.DispatcherFrame();
            window.Closed += (sender, args) => frame.Continue = false;
            window.Show();
            System.Windows.Threading.Dispatcher.PushFrame(frame);
            if (failure != null) throw new InvalidOperationException("Desktop smoke failed after [" + String.Join(", ", passed) + "]: " + failure, failure);
            return String.Join(Environment.NewLine, passed.Select(name => "PASS " + name));
        }

        private static object Invoke(object host, string method, params object[] args)
        {
            try { return host.GetType().GetMethod(method).Invoke(host, args); }
            catch (TargetInvocationException error) { throw error.InnerException ?? error; }
        }

        private static T Property<T>(object host, string name)
        {
            return (T)host.GetType().GetProperty(name).GetValue(host);
        }

        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static async Task WaitAsync(Func<Task<bool>> predicate, string description)
        {
            DateTime deadline = DateTime.UtcNow.AddSeconds(12);
            while (!await predicate()) {
                if (DateTime.UtcNow >= deadline) throw new TimeoutException(description);
                await Task.Delay(100);
            }
        }

        private static Task<string> Script(WebView2 view, string script)
        {
            return view.ExecuteScriptAsync(script);
        }

        private static async Task PostMessages(WebView2 view, string script)
        {
            // An inert marker follows messages on the same WebView queue, so
            // rejection assertions do not depend on an arbitrary sleep.
            string marker = "fixture:messages:" + Guid.NewGuid().ToString("N");
            var received = new TaskCompletionSource<bool>();
            EventHandler<CoreWebView2WebMessageReceivedEventArgs> handler = (sender, args) => {
                try { if (args.TryGetWebMessageAsString() == marker) received.TrySetResult(true); }
                catch (ArgumentException) { }
            };
            view.CoreWebView2.WebMessageReceived += handler;
            try {
                await Script(view, script + ";chrome.webview.postMessage('" + marker + "')");
                await WaitAsync(() => Task.FromResult(received.Task.IsCompleted), "Fixture message marker was not delivered.");
            } finally { view.CoreWebView2.WebMessageReceived -= handler; }
        }

        private static async Task Evaluate(WebView2 view, string script, bool userGesture = false)
        {
            string result = await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.evaluate",
                JsonSerializer.Serialize(new { expression = script, userGesture = userGesture, awaitPromise = true }));
            using (var json = JsonDocument.Parse(result)) {
                JsonElement error;
                if (json.RootElement.TryGetProperty("exceptionDetails", out error))
                    throw new InvalidOperationException("Fixture script failed: " + error.ToString());
            }
        }

        private static bool Policy(Type type, string name, params object[] args)
        {
            return (bool)type.GetMethod(name).Invoke(null, args);
        }

        private static async Task VerifyAsync(Type type, object host, string origin, Panel tabs, ImageSource fixtureLogo, Window window)
        {
            Check(Policy(type, "IsNotebookAddress", origin + "/one", origin), "Local fixture origin must be accepted.");
            foreach (string forbidden in new[] { "file:///C:/test.html", "javascript:alert(1)", "https://example.invalid/", "http://127.0.0.1:1/", "http://user@" + new Uri(origin).Authority + "/" }) {
                Check(!Policy(type, "IsNotebookAddress", forbidden, origin), "Notebook address accepted: " + forbidden);
            }
            Check(!Policy(type, "IsExternalAddress", "file:///C:/test.html"), "External file URL was accepted.");
            Check(!Policy(type, "IsExternalAddress", "javascript:alert(1)"), "External javascript URL was accepted.");
            bool rejected = false;
            try { Invoke(host, "OpenNotebook", "invalid", "Invalid", "http://127.0.0.1:1/"); }
            catch (InvalidOperationException) { rejected = true; }
            Check(rejected && Property<int>(host, "OpenCount") == 0, "Unregistered origin must not create a view.");
            passed.Add("registered origin policy");

            Invoke(host, "OpenNotebook", "one", "One", origin + "/one");
            await WaitAsync(() => Task.FromResult(Property<int>(host, "ReadyCount") == 1), "First real WebView did not become ready.");
            var first = (WebView2)Invoke(host, "GetView", "one");
            Check(await Script(first, "window.earlyDesktop") == "true", "Desktop flag was unavailable to the initial page script.");
            Check(!first.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled, "Browser accelerators remain enabled.");
            Check(!first.CoreWebView2.Settings.AreHostObjectsAllowed && first.CoreWebView2.Settings.IsWebMessageEnabled, "The constrained navigation bridge is unavailable or host objects were exposed.");
            Check(await Script(first, "window.__BABEL_DESKTOP_APP_COMMANDS__") == "true", "Main APP command capability is missing.");
            Check(await Script(first, "window.__BABEL_DESKTOP_WINDOW_COMMANDS__") == "true", "Main window command capability is missing.");
            await Script(first, "window.fixtureState = 42");
            passed.Add("real WebView initialization and isolated native settings");

            Invoke(host, "OpenNotebook", "two", "Two", origin + "/two");
            await WaitAsync(() => Task.FromResult(Property<int>(host, "ReadyCount") == 2), "Second real WebView did not become ready.");
            var second = (WebView2)Invoke(host, "GetView", "two");
            Check(!Object.ReferenceEquals(first, second), "Notebooks share one view instance.");
            Check(await Script(second, "window.fixtureState") == "0", "Notebook script state leaked between views.");
            Check(tabs.Children.Count == 2, "The notebook tab strip does not match the open views.");
            var firstTab = (Border)tabs.Children[0];
            var secondTab = (Border)tabs.Children[1];
            var firstActions = (StackPanel)firstTab.Child;
            var selectFirst = (Button)firstActions.Children[0];
            var firstBrand = (StackPanel)selectFirst.Content;
            Check(((Image)firstBrand.Children[0]).Source == fixtureLogo &&
                ((TextBlock)firstBrand.Children[1]).Text == "One", "A notebook tab lost its own logo or readable name.");
            Check(System.Windows.Automation.AutomationProperties.GetName(selectFirst) == "Switch to One" &&
                System.Windows.Automation.AutomationProperties.GetName((Button)firstActions.Children[1]) == "Close One view",
                "Notebook switching and closing require separate accessible names.");
            Check(firstTab.Tag == null && (string)secondTab.Tag == "active", "The active APP tab is not reflected in its visual state.");
            Invoke(host, "ShowHome");
            Check(Property<bool>(host, "IsHomeVisible"), "Home did not become visible.");
            Check(firstTab.Tag == null && secondTab.Tag == null, "Returning home left an APP tab selected.");
            selectFirst.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            Check((string)firstTab.Tag == "active" && secondTab.Tag == null, "Clicking the branded tab did not select its APP.");
            Check(Property<int>(host, "OpenCount") == 2, "Switching recreated a notebook.");
            Check(Object.ReferenceEquals(first, Invoke(host, "GetView", "one")), "Switching replaced the original WebView.");
            Check(await Script(first, "window.fixtureState") == "42", "Switching lost page state.");
            passed.Add("independent notebook instances and state-preserving switching");

            Check(firstBrand.Children.Count == 2, "The APP tab should show only its logo and name.");
            Check(((StackPanel)((Button)((StackPanel)secondTab.Child).Children[0]).Content).Children.Count == 2,
                "The second APP tab should show only its logo and name.");
            foreach (string command in new[] { null, "", "openFile", "selectApp0", "selectApp01", "selectApp11", "selectTab1", "selectApp2 " })
                Check(!(bool)Invoke(host, "ExecuteAppCommand", command), "Unknown native command was accepted: " + command);
            Check(Policy(type, "IsAppNavigationCommand", "selectApp10"), "The tenth APP command is missing.");
            await PostMessages(first, "chrome.webview.postMessage({command:'selectApp2'}); chrome.webview.postMessage('babel:command:openFile'); chrome.webview.postMessage('selectApp2')");
            Check(Property<string>(host, "ActiveAppId") == "one", "Malformed or unknown messages changed the active APP.");
            await PostMessages(second, "chrome.webview.postMessage('babel:command:selectApp2')");
            Check(Property<string>(host, "ActiveAppId") == "one", "A background APP changed the active view.");
            await Evaluate(first, "new Promise(resolve => {const frame=document.createElement('iframe');frame.src='/frame';frame.onload=()=>{frame.contentWindow.chrome.webview.postMessage('babel:command:selectApp2');resolve()};document.body.append(frame)})");
            await PostMessages(first, "void 0");
            Check(Property<string>(host, "ActiveAppId") == "one", "An iframe message changed the active APP.");
            await PostMessages(first, "chrome.webview.postMessage('babel:command:selectApp2')");
            await WaitAsync(() => Task.FromResult(Property<string>(host, "ActiveAppId") == "two"), "APP command message did not switch to the second APP.");
            await Script(second, "chrome.webview.postMessage('babel:command:appHome')");
            await WaitAsync(() => Task.FromResult(Property<bool>(host, "IsHomeVisible")), "APP command message did not return home.");
            Invoke(host, "ExecuteAppCommand", "previousAppTab");
            Check(Property<string>(host, "ActiveAppId") == "two", "Previous APP from home did not select the last APP.");
            Invoke(host, "ExecuteAppCommand", "nextAppTab");
            Check(Property<string>(host, "ActiveAppId") == "one", "APP tab cycling did not wrap.");
            Invoke(host, "ExecuteAppCommand", "selectApp10");
            Check(Property<string>(host, "ActiveAppId") == "one", "Missing APP position changed selection.");
            Invoke(host, "OpenNotebook", "temporary", "Temporary", origin + "/temporary");
            await WaitAsync(() => Task.FromResult(Property<int>(host, "ReadyCount") == 3), "Temporary APP did not load.");
            await Script((WebView2)Invoke(host, "GetView", "temporary"), "chrome.webview.postMessage('babel:command:closeAppTab')");
            await WaitAsync(() => Task.FromResult(Property<int>(host, "OpenCount") == 2), "Close APP command did not close the clean APP.");
            Invoke(host, "ExecuteAppCommand", "selectApp1");
            Check(Property<string>(host, "ActiveAppId") == "one", "Closing a tab corrupted APP positions.");
            passed.Add("allowlisted APP navigation bridge, tab positions and clean close");

            Check(!(bool)Invoke(host, "ExecuteWindowCommand", window, "openFile"), "Unknown window command was accepted.");
            Check(!(bool)Invoke(host, "ExecuteWindowCommand", new Window(), "closeWindow"), "Foreign window command target was accepted.");
            await PostMessages(second, "chrome.webview.postMessage('babel:command:toggleMaximizeWindow')");
            Check(window.WindowState == WindowState.Normal, "A background APP changed the window state.");
            await PostMessages(first, "chrome.webview.postMessage('babel:command:minimizeWindow')");
            Check(window.WindowState == WindowState.Minimized, "Main window minimize bridge failed.");
            window.WindowState = WindowState.Normal;
            await PostMessages(first, "chrome.webview.postMessage('babel:command:toggleMaximizeWindow')");
            Check(window.WindowState == WindowState.Maximized, "Main window maximize bridge failed.");
            await PostMessages(first, "chrome.webview.postMessage('babel:command:toggleMaximizeWindow')");
            Check(window.WindowState == WindowState.Normal, "Main window restore bridge failed.");
            await Evaluate(first, "document.querySelector('iframe').contentWindow.chrome.webview.postMessage('babel:command:minimizeWindow')");
            await PostMessages(first, "void 0");
            Check(window.WindowState == WindowState.Normal, "An iframe changed the main window state.");
            int closeRequests = 0;
            System.ComponentModel.CancelEventHandler cancelClose = (sender, args) => { closeRequests++; args.Cancel = true; };
            window.Closing += cancelClose;
            try {
                await Script(first, "chrome.webview.postMessage('babel:command:closeWindow')");
                await WaitAsync(() => Task.FromResult(closeRequests == 1), "Window close command did not reach Closing.");
                Check(window.IsVisible && Property<int>(host, "OpenCount") == 2, "Window close command bypassed cancellation.");
            } finally { window.Closing -= cancelClose; }
            passed.Add("current-window command allowlist, minimize/maximize/restore and cancellable close");

            Invoke(host, "RefreshShortcutSettings");
            await WaitAsync(async () => await Script(first, "window.shortcutEvents") == "1" && await Script(second, "window.shortcutEvents") == "1", "Shortcut changes did not reach both live pages.");
            Check(await Script(first, "window.fixtureState") == "42", "Shortcut refresh reloaded the page.");
            passed.Add("shortcut broadcast without page reload");

            Check(!await (Task<bool>)type.GetMethod("HasUnsavedChangesAsync").Invoke(null, new object[] { first }), "Clean fixture was reported dirty.");
            await Script(first, "window.fixtureDirty = true");
            Check(await (Task<bool>)type.GetMethod("HasUnsavedChangesAsync").Invoke(null, new object[] { first }), "Dirty fixture was reported clean.");
            await Script(first, "window.fixtureDirty = false");
            passed.Add("clean and dirty beforeunload handling");

            var blocked = new TaskCompletionSource<bool>();
            string outside = "http://127.0.0.2:" + new Uri(origin).Port + "/outside";
            first.CoreWebView2.NavigationStarting += (sender, args) => {
                if (args.Uri == outside) blocked.TrySetResult(args.Cancel && args.IsRedirected);
            };
            await Evaluate(first, "location.href = '/redirect'");
            await WaitAsync(() => Task.FromResult(blocked.Task.IsCompleted), "External redirect was not observed.");
            Check(await blocked.Task, "External redirect was not canceled.");
            Check(await Script(first, "window.fixtureState") == "42", "Blocked redirect changed the source view.");
            passed.Add("external redirect blocked without replacing the local page");

            await VerifyPopups(host, first, origin, window);
            passed.Add("same-origin and blank popups preserve live window references and reader DOM");

            Invoke(host, "OpenNotebook", "failed", "Failed request", origin + "/abort");
            var failed = (WebView2)Invoke(host, "GetView", "failed");
            await WaitAsync(() => Task.FromResult(failed.Visibility != Visibility.Visible), "Failed WebView did not hide its HWND for the error panel.");
            var failedSurface = (Panel)failed.Parent;
            Check(failedSurface.Children.Count > 1 && failedSurface.Children[1].Visibility == Visibility.Visible, "Failure panel is not visible above the hidden browser view.");
            passed.Add("failed navigation hides the browser HWND and displays recovery controls");

            Invoke(host, "OpenNotebook", "hang", "Unresponsive fixture", origin + "/hang");
            var hanging = (WebView2)Invoke(host, "GetView", "hang");
            await WaitAsync(async () => hanging.CoreWebView2 != null && await Script(hanging, "window.fixtureName") == "\"/hang\"", "Unresponsive fixture did not load.");
            DateTime checkStarted = DateTime.UtcNow;
            bool timedOut = false;
            try { await (Task<bool>)type.GetMethod("HasUnsavedChangesAsync").Invoke(null, new object[] { hanging }); }
            catch (TimeoutException) { timedOut = true; }
            Check(timedOut && (DateTime.UtcNow - checkStarted).TotalSeconds < 9, "Unresponsive beforeunload check did not return a bounded timeout.");
            passed.Add("unresponsive beforeunload check times out within the expected bound");
        }

        private static async Task VerifyPopups(object host, WebView2 opener, string origin, Window window)
        {
            int initialCount = Property<int>(host, "OpenCount");
            await Evaluate(opener, "window.fixturePopup = window.open('/popup', '_blank')", true);
            await WaitAsync(() => Task.FromResult(Property<int>(host, "OpenCount") == initialCount + 1), "Same-origin popup was not hosted.");
            await WaitAsync(async () => await Script(opener, "!!window.fixturePopup && !window.fixturePopup.closed && window.fixturePopup.fixtureName === '/popup'") == "true", "Popup did not retain a live same-origin Window reference.");
            Check(opener.Source.AbsoluteUri == origin + "/one" && await Script(opener, "window.fixtureState") == "42", "Opening a popup replaced the source page.");
            await Evaluate(opener,
                "window.fixtureReader = window.open('', '_blank'); window.fixtureReader.opener = null;" +
                "window.prepareFixtureReader(window.fixtureReader, document, 'Reader fixture').innerHTML = '<p id=reader style=color:rgb(1,2,3)>Reader fixture</p>';", true);
            await WaitAsync(() => Task.FromResult(Property<int>(host, "OpenCount") == initialCount + 2), "Blank reader popup was not hosted.");
            await Evaluate(opener,
                "window.fixtureNoteBReader = window.open('', '_blank');" +
                "window.prepareFixtureReader(window.fixtureNoteBReader, document, 'Note B — Reader').innerHTML = '<p>Note B</p>';", true);
            await WaitAsync(() => Task.FromResult(Property<int>(host, "OpenCount") == initialCount + 3), "Second note reader was not hosted independently.");
            await Evaluate(opener,
                "window.fixtureNoteBEditor = window.open('', '_blank');" +
                "window.prepareFixtureEditor(window.fixtureNoteBEditor, document, 'Note B — Editor').innerHTML = '<textarea id=note-b>Draft B</textarea>';", true);
            await WaitAsync(() => Task.FromResult(Property<int>(host, "OpenCount") == initialCount + 4), "Second note editor was not hosted independently.");
            Check(await Script(opener,
                "new Set([window.fixturePopup, window.fixtureReader, window.fixtureNoteBReader, window.fixtureNoteBEditor]).size") == "4",
                "Reader/editor windows for the same or different notes shared a window instance.");
            Check(await Script(opener, "window.fixtureReader.document.getElementById('reader').textContent") == "\"Reader fixture\"", "Opener could not populate a blank reader window.");
            Check(await Script(opener, "window.fixtureReader.opener === null") == "true", "Detached reader failed to clear its opener.");
            bool readerDesktopFlag = await Script(opener, "window.fixtureReader.__BABEL_DESKTOP__ === true") == "true";
            Check(await Script(opener, "getComputedStyle(window.fixtureReader.document.getElementById('reader')).color") == "\"rgb(1, 2, 3)\"", "Opener could not read detached reader text styles.");
            await Script(opener, "(() => {const popup=window.fixtureReader; const range=popup.document.createRange(); range.selectNodeContents(popup.document.getElementById('reader')); popup.getSelection().removeAllRanges(); popup.getSelection().addRange(range);})()");
            Check(await Script(opener, "window.fixtureReader.getSelection().toString()") == "\"Reader fixture\"", "Detached reader selection is unavailable to annotations.");
            var detached = Property<string[]>(host, "OpenIds")
                .Where(id => id.Contains(":"))
                .Select(id => Window.GetWindow((WebView2)Invoke(host, "GetView", id))).ToArray();
            Check(detached.Length == 4 && detached.All(view => view.Owner == null),
                "Detached note windows are still owned by the APP.");
            window.WindowState = WindowState.Minimized;
            await Task.Delay(150);
            Check(detached.All(view => view.IsVisible && view.WindowState == WindowState.Normal),
                "Minimizing the APP also minimized a detached window.");
            window.Hide();
            Check(detached.All(view => view.IsVisible), "Hiding the APP also hid a detached window.");
            window.Show();
            window.WindowState = WindowState.Normal;
            detached[0].WindowState = WindowState.Minimized;
            await Task.Delay(150);
            Check(window.WindowState == WindowState.Normal && detached.Skip(1).All(view => view.WindowState == WindowState.Normal),
                "Minimizing one note affected the APP or another detached note.");
            detached[0].WindowState = WindowState.Normal;
            foreach (string id in Property<string[]>(host, "OpenIds")) {
                var view = (WebView2)Invoke(host, "GetView", id);
                Check(!view.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled &&
                    !view.CoreWebView2.Settings.AreHostObjectsAllowed && view.CoreWebView2.Settings.IsWebMessageEnabled,
                    "APP and popup native bridge policies differ from their capabilities.");
                if (id.Contains(":")) Check(await Script(view, "window.__BABEL_DESKTOP_APP_COMMANDS__ === true") == "false", "Popup inherited APP command capability.");
                await WaitAsync(async () => await Script(view, "window.__BABEL_DESKTOP_WINDOW_COMMANDS__ === true") == "true",
                    "Window lost its window command capability: " + id + " at " + view.CoreWebView2.Source);
            }
            Invoke(host, "ExecuteAppCommand", "selectApp2");
            Check(Property<string>(host, "ActiveAppId") == "two", "Popup occupied an APP shortcut position.");
            Invoke(host, "ExecuteAppCommand", "selectApp1");
            Check(readerDesktopFlag, "Detached reader desktop flag is missing after document.write (reader DOM, getComputedStyle, selection and native settings all passed).");
            string noteBReaderId = Property<string[]>(host, "OpenIds").First(id => id.Contains(":") &&
                Window.GetWindow((WebView2)Invoke(host, "GetView", id)).Title == "Babel · Note B — Reader");
            var noteBReader = (WebView2)Invoke(host, "GetView", noteBReaderId);
            var noteBWindow = Window.GetWindow(noteBReader);
            await PostMessages(noteBReader, "chrome.webview.postMessage('babel:command:selectApp2')");
            Check(Property<string>(host, "ActiveAppId") == "one", "A detached window switched main APP tabs.");
            await PostMessages(noteBReader, "chrome.webview.postMessage('babel:command:minimizeWindow')");
            Check(noteBWindow.WindowState == WindowState.Minimized && window.WindowState == WindowState.Normal,
                "A detached window command minimized the main window.");
            noteBWindow.WindowState = WindowState.Normal;
            await PostMessages(noteBReader, "chrome.webview.postMessage('babel:command:toggleMaximizeWindow')");
            Check(noteBWindow.WindowState == WindowState.Maximized && window.WindowState == WindowState.Normal,
                "A detached window command maximized the wrong window.");
            await PostMessages(noteBReader, "chrome.webview.postMessage('babel:command:toggleMaximizeWindow')");
            Check(noteBWindow.WindowState == WindowState.Normal, "Detached restore command failed.");
            await Script(noteBReader, "chrome.webview.postMessage('babel:command:closeWindow')");
            await WaitAsync(() => Task.FromResult(Property<int>(host, "OpenCount") == initialCount + 3), "Closing one note reader did not remove only that window.");
            Check(await Script(opener,
                "!window.fixturePopup.closed && !window.fixtureReader.closed && !window.fixtureNoteBEditor.closed && " +
                "window.fixtureNoteBEditor.document.getElementById('note-b').value === 'Draft B'") == "true",
                "Closing a reader closed another mode/window or lost the editor draft.");
            passed.Add("independent note reader/editor windows survive APP minimize/hide and isolated close");
        }
    }
}
