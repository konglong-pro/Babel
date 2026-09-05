using System;
using System.IO;
using System.Management.Automation;
using System.Management.Automation.Runspaces;
using System.Reflection;
using System.Text;
using System.Threading;
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
        using (Runspace runspace = CreateStaRunspace())
        using (PowerShell powerShell = PowerShell.Create())
        {
            powerShell.Runspace = runspace;
            powerShell.AddCommand(guiScript);
            foreach (string argument in args)
            {
                if (argument.Length < 2 || argument[0] != '-')
                {
                    throw new ArgumentException("Unsupported Babel launcher argument: " + argument);
                }

                powerShell.AddParameter(argument.TrimStart('-'));
            }

            return InvokePowerShell(powerShell, runspace);
        }
    }

    private static int InvokeScript(string script)
    {
        using (Runspace runspace = CreateStaRunspace())
        using (PowerShell powerShell = PowerShell.Create())
        {
            powerShell.Runspace = runspace;
            powerShell.AddScript(script);
            return InvokePowerShell(powerShell, runspace);
        }
    }

    private static Runspace CreateStaRunspace()
    {
        InitialSessionState sessionState = InitialSessionState.CreateDefault();
        // Match the PowerShell entrypoints without changing machine or user policy.
        sessionState.ExecutionPolicy = Microsoft.PowerShell.ExecutionPolicy.Bypass;
        Runspace runspace = RunspaceFactory.CreateRunspace(sessionState);
        runspace.ApartmentState = ApartmentState.STA;
        runspace.ThreadOptions = PSThreadOptions.UseNewThread;
        runspace.Open();
        return runspace;
    }

    private static int InvokePowerShell(PowerShell powerShell, Runspace runspace)
    {
        powerShell.Invoke();

        if (powerShell.HadErrors)
        {
            string message = powerShell.Streams.Error.Count > 0
                ? powerShell.Streams.Error[0].ToString()
                : "The hosted PowerShell invocation failed.";
            throw new InvalidOperationException(message);
        }

        object exitCode = runspace.SessionStateProxy.GetVariable("BabelLauncherExitCode");
        return exitCode == null ? 0 : Convert.ToInt32(exitCode);
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
