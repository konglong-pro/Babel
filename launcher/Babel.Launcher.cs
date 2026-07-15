using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("Babel Launcher")]
[assembly: AssemblyDescription("Native entry point for the Babel WPF launcher")]
[assembly: AssemblyCompany("Babel")]
[assembly: AssemblyProduct("Babel Launcher")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        string launcherDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string repositoryRoot = Path.GetFullPath(Path.Combine(launcherDirectory, ".."));
        string guiScript = Path.Combine(launcherDirectory, "Babel.Gui.ps1");
        string powershell = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.System),
            @"WindowsPowerShell\v1.0\powershell.exe"
        );

        if (!File.Exists(guiScript))
        {
            return Fail("Babel.Gui.ps1 was not found next to Babel.exe.", args);
        }

        if (!File.Exists(powershell))
        {
            return Fail("Windows PowerShell could not be found.", args);
        }

        var commandArguments = new List<string>
        {
            "-NoLogo",
            "-NoProfile",
            "-STA",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            guiScript,
        };
        commandArguments.AddRange(args);

        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = powershell,
                Arguments = JoinArguments(commandArguments),
                WorkingDirectory = repositoryRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };

            using (Process process = Process.Start(startInfo))
            {
                if (process == null)
                {
                    return Fail("Windows PowerShell did not start.", args);
                }

                process.WaitForExit();
                if (process.ExitCode != 0 && args.Length == 0)
                {
                    return Fail(
                        "Babel Launcher could not open. Run Babel.Gui.ps1 -SmokeTest in PowerShell for details.",
                        args
                    );
                }

                return process.ExitCode;
            }
        }
        catch (Exception exception)
        {
            return Fail("Babel Launcher could not open. " + exception.Message, args);
        }
    }

    private static int Fail(string message, string[] args)
    {
        if (args.Length == 0)
        {
            Application.EnableVisualStyles();
            MessageBox.Show(message, "Babel Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        else
        {
            Console.Error.WriteLine(message);
        }

        return 1;
    }

    private static string JoinArguments(IEnumerable<string> arguments)
    {
        var commandLine = new StringBuilder();
        foreach (string argument in arguments)
        {
            if (commandLine.Length > 0)
            {
                commandLine.Append(' ');
            }

            commandLine.Append(QuoteArgument(argument));
        }

        return commandLine.ToString();
    }

    private static string QuoteArgument(string argument)
    {
        if (argument.Length > 0 && argument.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
        {
            return argument;
        }

        var quoted = new StringBuilder();
        quoted.Append('"');
        int backslashes = 0;

        foreach (char character in argument)
        {
            if (character == '\\')
            {
                backslashes += 1;
                continue;
            }

            if (character == '"')
            {
                quoted.Append('\\', (backslashes * 2) + 1);
                quoted.Append('"');
                backslashes = 0;
                continue;
            }

            quoted.Append('\\', backslashes);
            quoted.Append(character);
            backslashes = 0;
        }

        quoted.Append('\\', backslashes * 2);
        quoted.Append('"');
        return quoted.ToString();
    }
}
