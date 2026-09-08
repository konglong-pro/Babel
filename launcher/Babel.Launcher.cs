using System;
using System.IO;
using System.Diagnostics;
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
    private const string EncodedCommandArgument = "--encoded-command";

    [STAThread]
    private static int Main(string[] args)
    {
        string launcherDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string repositoryRoot = Path.GetFullPath(Path.Combine(launcherDirectory, ".."));
        string guiScript = Path.Combine(launcherDirectory, "Babel.Gui.ps1");

        if (!File.Exists(guiScript))
        {
            return Fail("Babel.Gui.ps1 was not found next to Babel.exe.", args);
        }

        try
        {
            Directory.SetCurrentDirectory(repositoryRoot);

            if (args.Length > 0 && String.Equals(
                args[0],
                EncodedCommandArgument,
                StringComparison.OrdinalIgnoreCase
            ))
            {
                if (args.Length != 2)
                {
                    return Fail("The encoded worker command is invalid.", args);
                }

                string script = Encoding.Unicode.GetString(Convert.FromBase64String(args[1]));
                return InvokeScript(script);
            }

            return InvokeGui(guiScript, args);
        }
        catch (Exception exception)
        {
            return Fail("Babel Launcher could not open. " + exception.Message, args);
        }
    }

    private static int InvokeGui(string guiScript, string[] args)
    {
        string command = "& '" + guiScript.Replace("'", "''") + "'";
        foreach (string argument in args)
        {
            if (argument.Length < 2 || argument[0] != '-')
                throw new ArgumentException("Unsupported Babel launcher argument: " + argument);
            foreach (char character in argument.TrimStart('-'))
                if (!Char.IsLetter(character))
                    throw new ArgumentException("Unsupported Babel launcher argument: " + argument);
            command += " " + argument;
        }
        return InvokeScript(command);
    }

    private static int InvokeScript(string script)
    {
        // Keep terminating errors and worker status visible to callers.
        string command = "$ErrorActionPreference = 'Stop'; try { " + script +
            "; if ($null -ne $global:BabelLauncherExitCode) { exit $global:BabelLauncherExitCode }" +
            " } catch { [Console]::Error.WriteLine($_); exit 1 }";
        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = "pwsh.exe";
        startInfo.Arguments = "-NoLogo -NoProfile -NonInteractive -STA -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand " +
            Convert.ToBase64String(Encoding.Unicode.GetBytes(command));
        startInfo.UseShellExecute = false;
        startInfo.CreateNoWindow = true;
        startInfo.WorkingDirectory = Directory.GetCurrentDirectory();
        using (Process process = Process.Start(startInfo))
        {
            process.WaitForExit();
            return process.ExitCode;
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
}
