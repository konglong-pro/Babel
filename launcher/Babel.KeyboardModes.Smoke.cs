using System;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Wpf;

namespace BabelLauncher
{
    public static class KeyboardModesSmoke
    {
        public static string Run(Type hostType, string origin, string profile)
        {
            var window = new Window { Width = 1000, Height = 750, Left = -32000, Top = -32000,
                ShowActivated = false, ShowInTaskbar = false, WindowStyle = WindowStyle.None,
                Title = "Babel isolated keyboard modes fixture" };
            var surface = new Grid();
            var home = new Grid();
            surface.Children.Add(home);
            window.Content = surface;
            object host = Activator.CreateInstance(hostType, window, surface, home, new StackPanel(),
                new TextBlock(), profile, new[] { origin });
            Exception failure = null;
            string result = null;
            window.Loaded += async (sender, args) => {
                try {
                    hostType.GetMethod("OpenNotebook").Invoke(host, new object[] { "fixture", "Keyboard fixture", origin });
                    var view = (WebView2)hostType.GetMethod("GetView").Invoke(host, new object[] { "fixture" });
                    DateTime deadline = DateTime.UtcNow.AddSeconds(15);
                    while (view.CoreWebView2 == null || await view.ExecuteScriptAsync("typeof window.runModeFixture === 'function'") != "true") {
                        if (DateTime.UtcNow >= deadline) throw new TimeoutException("Keyboard fixture did not initialize.");
                        await Task.Delay(100);
                    }
                    string main = await Evaluate(view, "window.runModeFixture()");
                    await Evaluate(view, "window.openModeFixture('read'); 'opened'");
                    await Evaluate(view, "window.openModeFixture('edit'); 'opened'");
                    string popups = await Evaluate(view, "window.runPopupModeFixture()");
                    string sourceReturn = await VerifySourceReturn(hostType, host, window, view, origin);
                    result = String.Join(Environment.NewLine, (main + "\n" + popups + "\n" + sourceReturn).Split('\n').Select(line => "PASS " + line));
                } catch (Exception error) { failure = error; }
                finally { ((IDisposable)host).Dispose(); window.Close(); }
            };
            window.ShowDialog();
            if (failure != null) throw new InvalidOperationException("Keyboard mode fixture failed: " + failure.Message, failure);
            return result;
        }

        private static async Task<string> VerifySourceReturn(Type hostType, object host, Window window, WebView2 source, string origin)
        {
            string popupId = ((string[])hostType.GetProperty("OpenIds").GetValue(host)).First(id => id.StartsWith("fixture:"));
            var popup = (WebView2)hostType.GetMethod("GetView").Invoke(host, new object[] { popupId });
            var popupWindow = Window.GetWindow(popup);
            hostType.GetMethod("OpenNotebook").Invoke(host, new object[] { "second", "APP B", origin + "/blank" });
            var second = (WebView2)hostType.GetMethod("GetView").Invoke(host, new object[] { "second" });
            DateTime deadline = DateTime.UtcNow.AddSeconds(10);
            while (second.CoreWebView2 == null || await second.ExecuteScriptAsync("location.pathname === '/blank' && document.readyState === 'complete'") != "true") {
                if (DateTime.UtcNow >= deadline) throw new TimeoutException("Second APP fixture did not initialize.");
                await Task.Delay(100);
            }
            var sourceSurface = (FrameworkElement)source.Parent;
            var secondSurface = (FrameworkElement)second.Parent;
            if (sourceSurface.Visibility != Visibility.Collapsed || secondSurface.Visibility != Visibility.Visible)
                throw new InvalidOperationException("APP B did not become the active native surface.");

            bool activationObserved = false;
            popupWindow.Activated += (sender, args) => activationObserved = true;
            popupWindow.Activate();
            await Task.Delay(100);
            bool usedActivationFallback = !activationObserved;
            if (usedActivationFallback) {
                // Foreground activation can be denied for an offscreen fixture.
                // In that case exercise the same WPF Activated event explicitly.
                typeof(Window).GetMethod("OnActivated", BindingFlags.Instance | BindingFlags.NonPublic)
                    .Invoke(popupWindow, new object[] { EventArgs.Empty });
            }
            if (!activationObserved || sourceSurface.Visibility != Visibility.Visible || secondSurface.Visibility != Visibility.Collapsed ||
                window.Title != "Babel · Keyboard fixture")
                throw new InvalidOperationException("Activating an earlier APP's popup did not select its source APP.");
            if (source.IsKeyboardFocusWithin)
                throw new InvalidOperationException("Selecting the popup source stole keyboard focus into the main APP.");

            hostType.GetMethod("OpenNotebook").Invoke(host, new object[] { "second", "APP B", origin + "/blank" });
            await Evaluate(popup, "window.opener.focus(); window.opener.document.getElementById('item').focus(); window.close(); 'closing'");
            deadline = DateTime.UtcNow.AddSeconds(10);
            while (((string[])hostType.GetProperty("OpenIds").GetValue(host)).Contains(popupId) || sourceSurface.Visibility != Visibility.Visible) {
                if (DateTime.UtcNow >= deadline) throw new TimeoutException("Returning from a popup did not restore its source APP after closing.");
                await Task.Delay(100);
            }
            if (secondSurface.Visibility != Visibility.Collapsed || window.Title != "Babel · Keyboard fixture")
                throw new InvalidOperationException("Closing an earlier APP's popup left APP B selected.");
            return "native APP source restoration on popup activation and close (" +
                (usedActivationFallback ? "explicit WPF Activated event" : "Window.Activate") + ")";
        }

        private static async Task<string> Evaluate(WebView2 view, string script)
        {
            string response = await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.evaluate",
                JsonSerializer.Serialize(new { expression = script, userGesture = true, awaitPromise = true, returnByValue = true }));
            using (var document = JsonDocument.Parse(response)) {
                JsonElement error;
                if (document.RootElement.TryGetProperty("exceptionDetails", out error))
                    throw new InvalidOperationException(error.ToString());
                return document.RootElement.GetProperty("result").GetProperty("value").GetString();
            }
        }
    }
}
