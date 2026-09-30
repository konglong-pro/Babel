if ($null -eq ("Babel.DetachedProcess" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Babel {
    public static class DetachedProcess {
        private const uint DetachedProcessFlag = 0x00000008;

        [StructLayout(LayoutKind.Sequential)]
        private struct StartupInfo {
            public int Size;
            public IntPtr Reserved;
            public IntPtr Desktop;
            public IntPtr Title;
            public uint X;
            public uint Y;
            public uint XSize;
            public uint YSize;
            public uint XCountChars;
            public uint YCountChars;
            public uint FillAttribute;
            public uint Flags;
            public short ShowWindow;
            public short ReservedByteCount;
            public IntPtr ReservedBytes;
            public IntPtr StandardInput;
            public IntPtr StandardOutput;
            public IntPtr StandardError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessInformation {
            public IntPtr ProcessHandle;
            public IntPtr ThreadHandle;
            public uint ProcessId;
            public uint ThreadId;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateProcessW(
            string applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref StartupInfo startupInfo,
            out ProcessInformation processInformation
        );

        [DllImport("kernel32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        public static int Start(string fileName, string arguments, string workingDirectory) {
            var startupInfo = new StartupInfo {
                Size = Marshal.SizeOf(typeof(StartupInfo)),
            };
            var commandLine = new StringBuilder();
            commandLine.Append('"').Append(fileName).Append('"');
            if (!String.IsNullOrWhiteSpace(arguments)) {
                commandLine.Append(' ').Append(arguments);
            }

            ProcessInformation processInformation;
            if (!CreateProcessW(
                fileName,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                DetachedProcessFlag,
                IntPtr.Zero,
                workingDirectory,
                ref startupInfo,
                out processInformation
            )) {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            try {
                return checked((int)processInformation.ProcessId);
            } finally {
                CloseHandle(processInformation.ThreadHandle);
                CloseHandle(processInformation.ProcessHandle);
            }
        }
    }
}
"@
}

function Start-BabelDetachedProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Arguments,

        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory
    )

    $resolvedFilePath = [IO.Path]::GetFullPath($FilePath)
    $resolvedWorkingDirectory = [IO.Path]::GetFullPath($WorkingDirectory)
    $processId = [Babel.DetachedProcess]::Start(
        $resolvedFilePath,
        $Arguments,
        $resolvedWorkingDirectory
    )

    try {
        $process = [Diagnostics.Process]::GetProcessById($processId)
        # Cache a real process handle while the child is alive so ExitCode is
        # still available after an unexpected exit.
        $null = $process.Handle
        return $process
    } catch {
        throw "Detached process $processId exited before it could be monitored."
    }
}
