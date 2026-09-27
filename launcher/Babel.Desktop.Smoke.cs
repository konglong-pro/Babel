using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace BabelLauncher
{
    // Exercises real WebView2 controls with temporary local fixture pages. No
    // keyboard input is sent to the operating system or another application.
    public static class DesktopSmoke
    {
        private static readonly List<string> passed = new List<string>();

        public static string Run(Type hostType, string origin, string profile)
        {
            passed.Clear();
            var window = new Window {
                Width = 900, Height = 650, Left = -32000, Top = -32000,
                ShowActivated = false, ShowInTaskbar = false, WindowStyle = WindowStyle.None,
                Title = "Babel isolated desktop smoke test"
            };
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
            Exception failure = null;
            window.Loaded += async (sender, args) => {
                try {
                    Task verification = VerifyAsync(hostType, host, origin);
                    if (await Task.WhenAny(verification, Task.Delay(45000)) != verification)
                        throw new TimeoutException("Desktop smoke test exceeded 45 seconds.");
                    await verification;
                } catch (Exception error) { failure = error; }
                finally {
                    ((IDisposable)host).Dispose();
                    window.Close();
                }
            };
            window.ShowDialog();
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

        private static async Task VerifyAsync(Type type, object host, string origin)
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
            Check(!first.CoreWebView2.Settings.AreHostObjectsAllowed && !first.CoreWebView2.Settings.IsWebMessageEnabled, "A native page bridge remains enabled.");
            await Script(first, "window.fixtureState = 42");
            passed.Add("real WebView initialization and isolated native settings");

            Invoke(host, "OpenNotebook", "two", "Two", origin + "/two");
            await WaitAsync(() => Task.FromResult(Property<int>(host, "ReadyCount") == 2), "Second real WebView did not become ready.");
            var second = (WebView2)Invoke(host, "GetView", "two");
            Check(!Object.ReferenceEquals(first, second), "Notebooks share one view instance.");
            Check(await Script(second, "window.fixtureState") == "0", "Notebook script state leaked between views.");
            Invoke(host, "ShowHome");
            Check(Property<bool>(host, "IsHomeVisible"), "Home did not become visible.");
            Invoke(host, "OpenNotebook", "one", "One", origin + "/one");
            Check(Property<int>(host, "OpenCount") == 2, "Switching recreated a notebook.");
            Check(Object.ReferenceEquals(first, Invoke(host, "GetView", "one")), "Switching replaced the original WebView.");
            Check(await Script(first, "window.fixtureState") == "42", "Switching lost page state.");
            passed.Add("independent notebook instances and state-preserving switching");

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

            await VerifyPopups(host, first, origin);
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

        private static async Task VerifyPopups(object host, WebView2 opener, string origin)
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
            Check(await Script(opener, "window.fixtureReader.document.getElementById('reader').textContent") == "\"Reader fixture\"", "Opener could not populate a blank reader window.");
            Check(await Script(opener, "window.fixtureReader.opener === null") == "true", "Detached reader failed to clear its opener.");
            bool readerDesktopFlag = await Script(opener, "window.fixtureReader.__BABEL_DESKTOP__ === true") == "true";
            Check(await Script(opener, "getComputedStyle(window.fixtureReader.document.getElementById('reader')).color") == "\"rgb(1, 2, 3)\"", "Opener could not read detached reader text styles.");
            await Script(opener, "(() => {const popup=window.fixtureReader; const range=popup.document.createRange(); range.selectNodeContents(popup.document.getElementById('reader')); popup.getSelection().removeAllRanges(); popup.getSelection().addRange(range);})()");
            Check(await Script(opener, "window.fixtureReader.getSelection().toString()") == "\"Reader fixture\"", "Detached reader selection is unavailable to annotations.");
            foreach (string id in Property<string[]>(host, "OpenIds")) {
                var view = (WebView2)Invoke(host, "GetView", id);
                Check(!view.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled &&
                    !view.CoreWebView2.Settings.AreHostObjectsAllowed && !view.CoreWebView2.Settings.IsWebMessageEnabled,
                    "A popup retained browser accelerators or a native message bridge.");
            }
            Check(readerDesktopFlag, "Detached reader desktop flag is missing after document.write (reader DOM, getComputedStyle, selection and native settings all passed).");
        }
    }
}
