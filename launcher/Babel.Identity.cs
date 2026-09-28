using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace BabelLauncher
{
    // The windows live in pwsh.exe. Give the shell Babel's identity and relaunch
    // target instead of allowing it to group or pin them as PowerShell windows.
    public static class DesktopIdentity
    {
        public const string AppId = "Babel.Desktop";
        private static readonly Guid PropertySet = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");

        [StructLayout(LayoutKind.Sequential)]
        private struct PropertyKey
        {
            public Guid Format;
            public uint Id;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PropVariant
        {
            public ushort Type;
            public ushort Reserved1, Reserved2, Reserved3;
            public IntPtr Value;
            public IntPtr Padding;
        }

        [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IPropertyStore
        {
            void GetCount(out uint count);
            void GetAt(uint index, out PropertyKey key);
            void GetValue(ref PropertyKey key, out PropVariant value);
            void SetValue(ref PropertyKey key, ref PropVariant value);
            void Commit();
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);

        [DllImport("shell32.dll")]
        private static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid,
            [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);

        public static void InitializeProcess()
        {
            Marshal.ThrowExceptionForHR(SetCurrentProcessExplicitAppUserModelID(AppId));
        }

        public static void Attach(Window window, string launcherPath, string iconPath)
        {
            launcherPath = Path.GetFullPath(launcherPath);
            iconPath = Path.GetFullPath(iconPath);
            EventHandler initialize = null;
            initialize = (sender, args) => {
                window.SourceInitialized -= initialize;
                IntPtr handle = new WindowInteropHelper(window).Handle;
                SetWindowProperties(handle, launcherPath, iconPath);
                var source = HwndSource.FromHwnd(handle);
                HwndSourceHook cleanup = null;
                cleanup = (IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled) => {
                    // WM_DESTROY runs only after an uncancelled close. Windows
                    // requires these property values to be cleared before destruction.
                    if (message == 0x0002) {
                        ClearWindowProperties(hwnd);
                        source.RemoveHook(cleanup);
                    }
                    return IntPtr.Zero;
                };
                source.AddHook(cleanup);
            };
            window.SourceInitialized += initialize;
            if (new WindowInteropHelper(window).Handle != IntPtr.Zero) initialize(window, EventArgs.Empty);
        }

        private static IPropertyStore OpenStore(IntPtr handle)
        {
            Guid iid = typeof(IPropertyStore).GUID;
            IPropertyStore store;
            Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(handle, ref iid, out store));
            return store;
        }

        private static void SetString(IPropertyStore store, uint id, string text)
        {
            var key = new PropertyKey { Format = PropertySet, Id = id };
            var value = new PropVariant { Type = 31, Value = Marshal.StringToCoTaskMemUni(text) };
            try { store.SetValue(ref key, ref value); }
            finally { Marshal.FreeCoTaskMem(value.Value); }
        }

        private static void SetWindowProperties(IntPtr handle, string launcherPath, string iconPath)
        {
            var store = OpenStore(handle);
            try {
                SetString(store, 2, "\"" + launcherPath + "\"");
                SetString(store, 3, iconPath + ",0");
                SetString(store, 4, "Babel");
                SetString(store, 5, AppId);
            } finally { Marshal.ReleaseComObject(store); }
        }

        private static void ClearWindowProperties(IntPtr handle)
        {
            var store = OpenStore(handle);
            try {
                foreach (uint id in new uint[] { 2, 3, 4, 5 }) {
                    var key = new PropertyKey { Format = PropertySet, Id = id };
                    var empty = new PropVariant();
                    store.SetValue(ref key, ref empty);
                }
            } finally { Marshal.ReleaseComObject(store); }
        }
    }
}
