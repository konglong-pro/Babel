using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace BabelLauncher
{
    // The shell hosts registered notebooks. Its message bridge accepts only
    // allowlisted APP navigation commands; existing HTTP APIs own all data.
    public sealed class DesktopHost : IDisposable
    {
        private sealed class Notebook
        {
            public string Id;
            public string Name;
            public Uri Address;
            public Grid Surface;
            public Border Header;
            public Button SelectButton;
            public WebView2 View;
            public Window PopupWindow;
            public string ParentId;
            public bool AllowBlank;
            public string Status = "Loading…";
            public bool Disposed;
        }

        private readonly Window window;
        private readonly Panel surface;
        private readonly FrameworkElement home;
        private readonly Panel tabs;
        private readonly TextBlock status;
        private readonly string userDataFolder;
        private readonly HashSet<string> origins;
        private readonly Dictionary<string, Notebook> notebooks = new Dictionary<string, Notebook>();
        private readonly List<Notebook> appTabs = new List<Notebook>();
        private Notebook active;
        private bool disposed;
        private bool checkingClose;
        private bool closeApproved;

        public bool IsHomeVisible { get { return active == null; } }
        public bool IsWebContentFocused { get { return active != null && active.View.IsKeyboardFocusWithin; } }
        public string ActiveAppId { get { return active == null ? null : active.Id; } }
        public int OpenCount { get { return notebooks.Count; } }
        public string[] OpenIds { get { return notebooks.Keys.ToArray(); } }
        public int ReadyCount { get { return notebooks.Values.Count(n => n.Status == "Ready"); } }
        public Action<Window> ConfigureWindow { get; set; }
        public Func<string, ImageSource> ResolveAppLogo { get; set; }
        public Action HomeRequested { get; set; }

        public static bool IsAppNavigationCommand(string command)
        {
            if (command == "nextAppTab" || command == "previousAppTab" || command == "closeAppTab" || command == "appHome") return true;
            return Enumerable.Range(1, 10).Any(index => command == "selectApp" + index);
        }

        public bool ExecuteAppCommand(string command)
        {
            if (!IsAppNavigationCommand(command)) return false;
            if (disposed || closeApproved || checkingClose) return true;
            if (command == "appHome") {
                ShowHome();
                if (HomeRequested != null) HomeRequested();
                else home.MoveFocus(new TraversalRequest(FocusNavigationDirection.First));
                return true;
            }
            if (command == "closeAppTab") {
                if (active != null) _ = CloseNotebookAsync(active);
                return true;
            }
            if (appTabs.Count == 0) return true;
            int index;
            if (command.StartsWith("selectApp", StringComparison.Ordinal)) index = Int32.Parse(command.Substring(9)) - 1;
            else {
                index = appTabs.IndexOf(active);
                index = command == "nextAppTab" ? (index + 1) % appTabs.Count : (index < 0 ? appTabs.Count - 1 : (index + appTabs.Count - 1) % appTabs.Count);
            }
            if (index >= 0 && index < appTabs.Count) Select(appTabs[index]);
            return true;
        }

        public DesktopHost(Window window, Panel surface, FrameworkElement home,
            Panel tabs, TextBlock status, string userDataFolder, string[] allowedOrigins)
        {
            this.window = window;
            this.surface = surface;
            this.home = home;
            this.tabs = tabs;
            this.status = status;
            this.userDataFolder = userDataFolder;
            origins = new HashSet<string>(allowedOrigins, StringComparer.OrdinalIgnoreCase);
        }

        public static bool IsNotebookAddress(string candidate, string expectedOrigin)
        {
            Uri address;
            return Uri.TryCreate(candidate, UriKind.Absolute, out address) &&
                address.Scheme == Uri.UriSchemeHttp && address.IsLoopback &&
                address.UserInfo.Length == 0 &&
                String.Equals(address.GetLeftPart(UriPartial.Authority), expectedOrigin, StringComparison.OrdinalIgnoreCase);
        }

        public static bool IsExternalAddress(string candidate)
        {
            Uri address;
            return Uri.TryCreate(candidate, UriKind.Absolute, out address) &&
                (address.Scheme == Uri.UriSchemeHttps || address.Scheme == Uri.UriSchemeHttp || address.Scheme == "mailto") &&
                address.UserInfo.Length == 0;
        }

        public void OpenNotebook(string id, string name, string address)
        {
            if (disposed || closeApproved || checkingClose) return;
            Notebook existing;
            if (notebooks.TryGetValue(id, out existing)) { Select(existing); return; }
            Uri uri = new Uri(address, UriKind.Absolute);
            string origin = uri.GetLeftPart(UriPartial.Authority);
            if (!origins.Contains(origin) || !IsNotebookAddress(address, origin))
                throw new InvalidOperationException("Only registered local notebooks can open inside Babel.");

            var notebook = new Notebook { Id = id, Name = name, Address = uri, Surface = new Grid() };
            notebook.Header = new Border { Margin = new Thickness(0, 0, 6, 0) };
            var tabStyle = window.TryFindResource("DesktopAppTabStyle") as Style;
            if (tabStyle != null) notebook.Header.Style = tabStyle;
            var brand = new StackPanel { Orientation = Orientation.Horizontal };
            var logo = ResolveAppLogo == null ? null : ResolveAppLogo(id);
            if (logo != null) brand.Children.Add(new Image {
                Source = logo, Width = 24, Height = 24, Stretch = Stretch.Uniform, Margin = new Thickness(0, 0, 8, 0)
            });
            brand.Children.Add(new TextBlock {
                Text = name, MaxWidth = 160, TextWrapping = TextWrapping.NoWrap,
                TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center
            });
            notebook.SelectButton = new Button {
                Content = brand, Padding = new Thickness(12, 6, 10, 6), ToolTip = "Switch to " + name,
                VerticalAlignment = VerticalAlignment.Center
            };
            var selectStyle = window.TryFindResource("DesktopTabButtonStyle") as Style;
            if (selectStyle != null) notebook.SelectButton.Style = selectStyle;
            System.Windows.Automation.AutomationProperties.SetName(notebook.SelectButton, "Switch to " + name);
            notebook.SelectButton.Click += (sender, args) => Select(notebook);
            var close = new Button { Content = "×", ToolTip = "Close " + name + " view", VerticalAlignment = VerticalAlignment.Center };
            var closeStyle = window.TryFindResource("DesktopTabCloseButtonStyle") as Style;
            if (closeStyle != null) close.Style = closeStyle;
            System.Windows.Automation.AutomationProperties.SetName(close, "Close " + name + " view");
            close.Click += async (sender, args) => await CloseNotebookAsync(notebook);
            var tabContent = new StackPanel { Orientation = Orientation.Horizontal };
            tabContent.Children.Add(notebook.SelectButton);
            tabContent.Children.Add(close);
            notebook.Header.Child = tabContent;
            tabs.Children.Add(notebook.Header);
            surface.Children.Add(notebook.Surface);
            notebooks.Add(id, notebook);
            appTabs.Add(notebook);
            CreateView(notebook);
            Select(notebook);
            _ = InitializeNotebookAsync(notebook);
        }

        private void CreateView(Notebook notebook)
        {
            notebook.View = new WebView2 {
                CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = userDataFolder }
            };
            notebook.Surface.Children.Clear();
            notebook.Surface.Children.Add(notebook.View);
        }

        private async Task<bool> InitializeNotebookAsync(Notebook notebook,
            CoreWebView2Environment environment = null, CoreWebView2NewWindowRequestedEventArgs popupRequest = null)
        {
            var view = notebook.View;
            try
            {
                await view.EnsureCoreWebView2Async(environment);
                if (disposed || notebook.Disposed || notebook.View != view) return false;
                var core = view.CoreWebView2;
                core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                core.Settings.AreHostObjectsAllowed = false;
                core.Settings.IsWebMessageEnabled = notebook.PopupWindow == null;
                core.Settings.IsStatusBarEnabled = false;
                string origin = notebook.Address.GetLeftPart(UriPartial.Authority);
                // Origin is validated as a loopback HTTP authority, not document text.
                await core.AddScriptToExecuteOnDocumentCreatedAsync(
                    "if (window.top === window && (location.origin === '" + origin + "'" +
                    (notebook.AllowBlank ? " || location.href === 'about:blank'" : "") + ")) {" +
                    "Object.defineProperty(window, '__BABEL_DESKTOP__', {value: true});" +
                    (notebook.PopupWindow == null ? "Object.defineProperty(window, '__BABEL_DESKTOP_APP_COMMANDS__', {value: true});" : "") + " }");
                if (disposed || notebook.Disposed || notebook.View != view) return false;
                if (notebook.PopupWindow == null) core.WebMessageReceived += (sender, args) => {
                    // This Core event receives top-level document messages. Frame
                    // messages have separate CoreWebView2Frame events, not wired here.
                    if (disposed || notebook.Disposed || notebook.View != view || active != notebook ||
                        !IsNotebookAddress(args.Source, origin) || !IsNotebookAddress(core.Source, origin)) return;
                    string message;
                    try { message = args.TryGetWebMessageAsString(); } catch (ArgumentException) { return; }
                    const string prefix = "babel:command:";
                    if (message != null && message.StartsWith(prefix, StringComparison.Ordinal))
                        ExecuteAppCommand(message.Substring(prefix.Length));
                };
                core.NavigationStarting += (sender, args) => {
                    if (IsNotebookAddress(args.Uri, origin) || (notebook.AllowBlank && args.Uri == "about:blank")) return;
                    args.Cancel = true;
                    if (args.IsUserInitiated && !args.IsRedirected) OpenExternal(args.Uri);
                };
                core.NewWindowRequested += async (sender, args) => await OpenPopupAsync(notebook, core.Environment, args);
                core.WindowCloseRequested += async (sender, args) => await CloseNotebookAsync(notebook);
                core.DocumentTitleChanged += (sender, args) => {
                    if (!notebook.Disposed && notebook.PopupWindow != null)
                        notebook.PopupWindow.Title = "Babel · " + core.DocumentTitle;
                };
                core.NavigationCompleted += (sender, args) => {
                    if (notebook.Disposed || notebook.View != view) return;
                    if (args.IsSuccess) SetStatus(notebook, "Ready");
                    else if (args.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                        ShowFailure(notebook, "The notebook could not load (" + args.WebErrorStatus + "). Check its service in Apps, then retry.");
                };
                core.ProcessFailed += (sender, args) => {
                    if (!notebook.Disposed && notebook.View == view && args.ProcessFailedKind != CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                        ShowFailure(notebook, "The notebook view stopped. Retry to reopen it.");
                };
                if (popupRequest == null) core.Navigate(notebook.Address.AbsoluteUri);
                else { popupRequest.NewWindow = core; SetStatus(notebook, "Ready"); }
                return true;
            }
            catch (Exception error)
            {
                if (!disposed && !notebook.Disposed && notebook.View == view)
                    ShowFailure(notebook, "Could not open the desktop view: " + error.Message);
                return false;
            }
        }

        private async Task OpenPopupAsync(Notebook parent, CoreWebView2Environment environment,
            CoreWebView2NewWindowRequestedEventArgs args)
        {
            args.Handled = true;
            if (disposed || parent.Disposed || checkingClose || closeApproved || !args.IsUserInitiated) return;
            string origin = parent.Address.GetLeftPart(UriPartial.Authority);
            bool blank = String.IsNullOrEmpty(args.Uri) || args.Uri == "about:blank";
            if (!blank && !IsNotebookAddress(args.Uri, origin)) { OpenExternal(args.Uri); return; }
            var deferral = args.GetDeferral();
            Notebook child = null;
            try {
                child = new Notebook {
                    Id = parent.Id + ":" + Guid.NewGuid().ToString("N"), ParentId = parent.Id,
                    Name = parent.Name, Address = blank ? parent.Address : new Uri(args.Uri),
                    AllowBlank = blank, Surface = new Grid()
                };
                child.PopupWindow = new Window {
                    Title = "Babel · " + parent.Name, Content = child.Surface, Icon = window.Icon,
                    Width = Math.Min(1240, SystemParameters.WorkArea.Width),
                    Height = Math.Min(900, SystemParameters.WorkArea.Height), MinWidth = 640, MinHeight = 480,
                    WindowStartupLocation = WindowStartupLocation.CenterScreen,
                    ShowInTaskbar = true, ShowActivated = true
                };
                // Keep the source APP association for data and close checks,
                // without a native owner that couples visibility and minimizing.
                var popup = child;
                if (ConfigureWindow != null) ConfigureWindow(child.PopupWindow);
                child.PopupWindow.Activated += (sender, eventArgs) => {
                    // Keep the popup's source APP visible without moving keyboard
                    // focus away from its reader/editor window.
                    if (!disposed && !checkingClose && !popup.Disposed)
                        SelectSourceNotebook(popup, false);
                };
                child.PopupWindow.Closing += async (sender, eventArgs) => {
                    if (popup.Disposed || closeApproved) return;
                    eventArgs.Cancel = true;
                    await CloseNotebookAsync(popup);
                };
                notebooks.Add(child.Id, child);
                CreateView(child);
                child.PopupWindow.Show();
                await InitializeNotebookAsync(child, environment, args);
            } catch (Exception error) {
                if (child != null && !child.Disposed) Remove(child);
                status.Text = "Could not open the notebook window: " + error.Message;
            } finally { deferral.Complete(); }
        }

        private void ShowFailure(Notebook notebook, string message)
        {
            SetStatus(notebook, "View unavailable");
            // WebView2 owns a native child window; a WPF overlay cannot cover it.
            notebook.View.Visibility = Visibility.Collapsed;
            if (notebook.Surface.Children.Count > 1) notebook.Surface.Children.RemoveAt(1);
            var panel = new StackPanel { MaxWidth = 640, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(32), Background = Brushes.White };
            panel.Children.Add(new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(16) });
            var retry = new Button { Content = notebook.PopupWindow == null ? "Retry" : "Close view", Padding = new Thickness(16, 8, 16, 8), Margin = new Thickness(16), HorizontalAlignment = HorizontalAlignment.Left };
            retry.Click += async (sender, args) => {
                if (checkingClose || disposed || notebook.Disposed) return;
                if (notebook.PopupWindow != null) { await CloseNotebookAsync(notebook); return; }
                checkingClose = true;
                SetInteractionEnabled(false);
                try {
                    var affected = DescendantsAndSelf(notebook);
                    if (!await ConfirmDiscardAsync(affected) || disposed || notebook.Disposed) return;
                    foreach (var child in affected.Where(n => n != notebook).Reverse()) Remove(child);
                    notebook.View.Dispose();
                    CreateView(notebook);
                    SetStatus(notebook, "Loading…");
                    await InitializeNotebookAsync(notebook);
                } finally { checkingClose = false; SetInteractionEnabled(true); }
            };
            panel.Children.Add(retry);
            notebook.Surface.Children.Add(panel);
        }

        private void OpenExternal(string address)
        {
            if (!IsExternalAddress(address)) return;
            try { Process.Start(new ProcessStartInfo(address) { UseShellExecute = true }); }
            catch (Exception error) { status.Text = "Could not open the link: " + error.Message; }
        }

        private void SetStatus(Notebook notebook, string message)
        {
            notebook.Status = message;
            if (active == notebook) status.Text = notebook.Name + " · " + message;
        }

        public void RefreshStatus()
        {
            if (active != null) SetStatus(active, active.Status);
        }

        private void Select(Notebook notebook, bool focusView = true)
        {
            if (notebook.Disposed || disposed) return;
            if (notebook.PopupWindow != null) { notebook.PopupWindow.Activate(); return; }
            active = notebook;
            home.Visibility = Visibility.Collapsed;
            var homeButton = window.FindName("DesktopHomeButton") as Button;
            if (homeButton != null) homeButton.Tag = null;
            foreach (var item in notebooks.Values) {
                if (item.PopupWindow != null) continue;
                item.Surface.Visibility = item == notebook ? Visibility.Visible : Visibility.Collapsed;
                item.Header.Tag = item == notebook ? "active" : null;
                item.SelectButton.Tag = item == notebook ? "active" : null;
            }
            // Selecting an offscreen tab must reveal it in a crowded tab strip.
            notebook.Header.BringIntoView();
            notebook.Header.Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded, new Action(() => {
                if (!disposed && !notebook.Disposed && active == notebook) notebook.Header.BringIntoView();
            }));
            window.Title = "Babel · " + notebook.Name;
            status.Text = notebook.Name + " · " + notebook.Status;
            if (focusView) notebook.View.Focus();
        }

        private void SelectSourceNotebook(Notebook popup, bool focusView)
        {
            Notebook source = popup;
            while (source.ParentId != null) {
                Notebook parent;
                if (!notebooks.TryGetValue(source.ParentId, out parent)) return;
                source = parent;
            }
            if (!source.Disposed && source != popup) Select(source, focusView);
        }

        public void ShowHome()
        {
            if (disposed) return;
            active = null;
            foreach (var item in notebooks.Values.Where(n => n.PopupWindow == null)) {
                item.Surface.Visibility = Visibility.Collapsed;
                item.Header.Tag = null;
                item.SelectButton.Tag = null;
            }
            var homeButton = window.FindName("DesktopHomeButton") as Button;
            if (homeButton != null) homeButton.Tag = "active";
            home.Visibility = Visibility.Visible;
            window.Title = "Babel";
            status.Text = "Apps home · Start, open and manage notebooks";
        }

        public async void RefreshShortcutSettings()
        {
            await Task.WhenAll(notebooks.Values.ToArray().Select(async notebook => {
                try {
                    if (!notebook.Disposed && notebook.View.CoreWebView2 != null)
                        await ExecuteScriptWithTimeoutAsync(notebook.View, "window.dispatchEvent(new Event('babel:shortcuts-changed'));");
                } catch { if (!notebook.Disposed) SetStatus(notebook, "Shortcut update failed; reopen this view to retry"); }
            }));
        }

        public WebView2 GetView(string id) { return notebooks[id].View; }

        private static async Task<string> ExecuteScriptWithTimeoutAsync(WebView2 view, string script)
        {
            var operation = view.ExecuteScriptAsync(script);
            if (await Task.WhenAny(operation, Task.Delay(TimeSpan.FromSeconds(5))) != operation) {
                // A timed-out renderer can fail later when its view is disposed.
                _ = operation.ContinueWith(task => { _ = task.Exception; },
                    TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously);
                throw new TimeoutException("The notebook did not respond within five seconds.");
            }
            return await operation;
        }

        // Native disposal does not fire the page's beforeunload handlers. Query
        // those handlers first so dirty/pending app edits also protect shell exit.
        public static async Task<bool> HasUnsavedChangesAsync(WebView2 view)
        {
            if (view.CoreWebView2 == null) return false;
            string result = await ExecuteScriptWithTimeoutAsync(view,
                "(() => {const event = new Event('beforeunload', {cancelable: true});" +
                "window.dispatchEvent(event); return event.defaultPrevented;})()");
            if (result == "true") return true;
            if (result == "false") return false;
            throw new InvalidOperationException("The notebook did not respond to the unsaved-changes check.");
        }

        private async Task<bool> ConfirmDiscardAsync(IEnumerable<Notebook> candidates)
        {
            // Check concurrently so one stalled renderer bounds the whole check,
            // rather than adding five seconds for every open notebook.
            var results = await Task.WhenAll(candidates.ToArray().Select(async notebook => {
                if (notebook.Disposed) return null;
                try {
                    return await HasUnsavedChangesAsync(notebook.View) ? notebook.Name : null;
                } catch { return notebook.Name + " (could not check changes)"; }
            }));
            var affected = results.Where(name => name != null).ToArray();
            return affected.Length == 0 || MessageBox.Show(window,
                "These notebooks may have unsaved changes:\n\n" + String.Join("\n", affected) +
                "\n\nDiscard changes and close?", "Babel — unsaved changes",
                MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) == MessageBoxResult.Yes;
        }

        private async Task CloseNotebookAsync(Notebook notebook)
        {
            if (checkingClose || disposed || notebook.Disposed) return;
            checkingClose = true;
            SetInteractionEnabled(false);
            try {
                var affected = DescendantsAndSelf(notebook);
                if (!await ConfirmDiscardAsync(affected)) return;
                // A popup may request close while inside its native Closing event.
                // Defer disposal to the next dispatcher turn as well.
                await window.Dispatcher.InvokeAsync(() => {
                    foreach (var item in affected.Reverse()) Remove(item);
                }, System.Windows.Threading.DispatcherPriority.Background);
            } finally { checkingClose = false; SetInteractionEnabled(true); }
            if (notebook.PopupWindow != null) SelectSourceNotebook(notebook, true);
        }

        private Notebook[] DescendantsAndSelf(Notebook notebook)
        {
            var result = new List<Notebook> { notebook };
            for (int index = 0; index < result.Count; index++)
                result.AddRange(notebooks.Values.Where(n => n.ParentId == result[index].Id));
            return result.ToArray();
        }

        private void SetInteractionEnabled(bool enabled)
        {
            if (disposed || (enabled && closeApproved)) return;
            surface.IsEnabled = enabled;
            tabs.IsEnabled = enabled;
            foreach (var notebook in notebooks.Values)
                if (notebook.PopupWindow != null) notebook.PopupWindow.IsEnabled = enabled;
        }

        // Called before the launcher's worker-stop handler. Approval triggers a
        // second Closing event, preserving its existing graceful shutdown flow.
        public bool RequestWindowClose()
        {
            if (disposed || closeApproved || notebooks.Count == 0) return true;
            if (!checkingClose) CheckWindowCloseAsync();
            return false;
        }

        private async void CheckWindowCloseAsync()
        {
            checkingClose = true;
            SetInteractionEnabled(false);
            try {
                if (!await ConfirmDiscardAsync(notebooks.Values)) return;
                closeApproved = true;
                // Even a not-yet-initialized WebView can complete its check
                // synchronously. Never reenter Window.Close from Closing.
                _ = window.Dispatcher.BeginInvoke(new Action(() => window.Close()));
            } finally { checkingClose = false; SetInteractionEnabled(true); }
        }

        private void Remove(Notebook notebook)
        {
            if (notebook.Disposed) return;
            notebook.Disposed = true;
            notebook.View.Dispose();
            if (notebook.PopupWindow != null) notebook.PopupWindow.Close();
            else {
                surface.Children.Remove(notebook.Surface);
                tabs.Children.Remove(notebook.Header);
            }
            notebooks.Remove(notebook.Id);
            appTabs.Remove(notebook);
            if (active == notebook) ShowHome();
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            foreach (var notebook in notebooks.Values.Reverse().ToArray()) Remove(notebook);
        }
    }
}
