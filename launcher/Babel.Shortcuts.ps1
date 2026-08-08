Set-StrictMode -Version 2.0

function Test-BabelShortcutProperty {
    param(
        [Parameter(Mandatory = $true)]
        [object]$InputObject,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    return $null -ne $InputObject.PSObject.Properties[$Name]
}

function Assert-BabelShortcutExactProperties {
    param(
        [Parameter(Mandatory = $true)]
        [object]$InputObject,

        [Parameter(Mandatory = $true)]
        [string[]]$Names,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $actualNames = @($InputObject.PSObject.Properties | ForEach-Object { [string]$_.Name })
    if ($actualNames.Count -ne $Names.Count) {
        throw "$Description must contain exactly: $($Names -join ', ')."
    }
    foreach ($name in $Names) {
        if ($actualNames -cnotcontains $name) {
            throw "$Description must contain exactly: $($Names -join ', ')."
        }
    }
}

function Get-BabelShortcutSettingsPath {
    param(
        [string]$LocalApplicationDataPath = [Environment]::GetFolderPath(
            [Environment+SpecialFolder]::LocalApplicationData
        )
    )

    if ([string]::IsNullOrWhiteSpace($LocalApplicationDataPath)) {
        throw "Windows did not provide a LocalApplicationData directory."
    }

    return [IO.Path]::GetFullPath(
        (Join-Path (Join-Path $LocalApplicationDataPath "Babel") "shortcuts.json")
    )
}

function Get-BabelLauncherHotkeySettingsPath {
    param(
        [string]$LocalApplicationDataPath = [Environment]::GetFolderPath(
            [Environment+SpecialFolder]::LocalApplicationData
        )
    )

    if ([string]::IsNullOrWhiteSpace($LocalApplicationDataPath)) {
        throw "Windows did not provide a LocalApplicationData directory."
    }

    return [IO.Path]::GetFullPath(
        (Join-Path (Join-Path $LocalApplicationDataPath "Babel") "launcher.json")
    )
}

function Get-BabelDefaultLauncherHotkeyBinding {
    return "Ctrl+Alt+B"
}

function ConvertTo-BabelShortcutBinding {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Binding
    )

    $trimmedBinding = $Binding.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmedBinding)) {
        throw "A shortcut binding cannot be empty."
    }

    $hasCtrl = $false
    $hasAlt = $false
    $hasShift = $false
    $keyName = $null
    $tokens = @($trimmedBinding -split "\+")

    :bindingToken foreach ($rawToken in $tokens) {
        $token = $rawToken.Trim()
        if ([string]::IsNullOrWhiteSpace($token)) {
            throw "Shortcut '$Binding' contains an empty key."
        }

        switch ($token.ToUpperInvariant()) {
            "CTRL" {
                if ($hasCtrl) {
                    throw "Shortcut '$Binding' repeats the Ctrl modifier."
                }
                $hasCtrl = $true
                continue bindingToken
            }
            "CONTROL" {
                if ($hasCtrl) {
                    throw "Shortcut '$Binding' repeats the Ctrl modifier."
                }
                $hasCtrl = $true
                continue bindingToken
            }
            "ALT" {
                if ($hasAlt) {
                    throw "Shortcut '$Binding' repeats the Alt modifier."
                }
                $hasAlt = $true
                continue bindingToken
            }
            "SHIFT" {
                if ($hasShift) {
                    throw "Shortcut '$Binding' repeats the Shift modifier."
                }
                $hasShift = $true
                continue bindingToken
            }
        }

        if ($null -ne $keyName) {
            throw "Shortcut '$Binding' contains more than one non-modifier key."
        }

        $upperToken = $token.ToUpperInvariant()
        if ($upperToken -match "^[A-Z]$") {
            $keyName = $upperToken
        } elseif ($upperToken -match "^[0-9]$") {
            $keyName = $upperToken
        } elseif ($upperToken -match "^F([1-9]|1[0-2])$") {
            $keyName = $upperToken
        } else {
            switch ($upperToken) {
                "ENTER" { $keyName = "Enter" }
                "RETURN" { $keyName = "Enter" }
                "ESC" { $keyName = "Escape" }
                "ESCAPE" { $keyName = "Escape" }
                "DELETE" { $keyName = "Delete" }
                "DEL" { $keyName = "Delete" }
                "BACKSPACE" { $keyName = "Backspace" }
                "BACK" { $keyName = "Backspace" }
                "SPACE" { $keyName = "Space" }
                "ARROWUP" { $keyName = "ArrowUp" }
                "UP" { $keyName = "ArrowUp" }
                "ARROWDOWN" { $keyName = "ArrowDown" }
                "DOWN" { $keyName = "ArrowDown" }
                "ARROWLEFT" { $keyName = "ArrowLeft" }
                "LEFT" { $keyName = "ArrowLeft" }
                "ARROWRIGHT" { $keyName = "ArrowRight" }
                "RIGHT" { $keyName = "ArrowRight" }
                "HOME" { $keyName = "Home" }
                "END" { $keyName = "End" }
                "PAGEUP" { $keyName = "PageUp" }
                "PAGEDOWN" { $keyName = "PageDown" }
                default {
                    throw "Shortcut '$Binding' uses unsupported key '$token'."
                }
            }
        }
    }

    if ($null -eq $keyName) {
        throw "Shortcut '$Binding' contains only modifier keys."
    }

    $canonicalParts = @()
    if ($hasCtrl) {
        $canonicalParts += "Ctrl"
    }
    if ($hasAlt) {
        $canonicalParts += "Alt"
    }
    if ($hasShift) {
        $canonicalParts += "Shift"
    }
    $canonicalParts += $keyName
    $canonicalBinding = $canonicalParts -join "+"

    $reservedBindings = @(
        "Alt+F4",
        "Alt+Escape",
        "Alt+Space",
        "Ctrl+Alt+Delete",
        "Ctrl+Alt+ArrowUp",
        "Ctrl+Alt+ArrowDown",
        "Ctrl+Escape",
        "Ctrl+Shift+Escape",
        "Ctrl+W",
        "Ctrl+Shift+W",
        "Ctrl+T",
        "Ctrl+Shift+T",
        "Ctrl+L",
        "F2",
        "F5",
        "Ctrl+F5",
        "F6",
        "F11",
        "F12"
    )
    if ($reservedBindings -contains $canonicalBinding) {
        throw "Shortcut '$canonicalBinding' is reserved by Windows or the browser."
    }
    $isBareFunctionKey = -not $hasCtrl -and -not $hasAlt -and -not $hasShift -and $keyName -match "^F([1-9]|1[0-2])$"
    if (
        -not $hasCtrl -and
        -not $hasAlt -and
        $canonicalBinding -ne "Escape" -and
        -not $isBareFunctionKey
    ) {
        throw "Shortcut '$canonicalBinding' must include Ctrl or Alt. Only Escape or a safe bare function key may omit them."
    }

    return $canonicalBinding
}

function ConvertTo-BabelLauncherHotkeyRegistration {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Binding
    )

    $canonicalBinding = ConvertTo-BabelShortcutBinding -Binding $Binding
    $modifiers = [uint32]0x4000
    $keyName = $null
    $hasLauncherModifier = $false
    foreach ($token in @($canonicalBinding -split "\+")) {
        switch ($token) {
            "Ctrl" {
                $hasLauncherModifier = $true
                $modifiers = $modifiers -bor [uint32]0x0002
                continue
            }
            "Alt" {
                $hasLauncherModifier = $true
                $modifiers = $modifiers -bor [uint32]0x0001
                continue
            }
            "Shift" { $modifiers = $modifiers -bor [uint32]0x0004; continue }
            default { $keyName = $token }
        }
    }
    if (-not $hasLauncherModifier) {
        throw "Launcher hotkey '$canonicalBinding' must include Ctrl or Alt."
    }

    $virtualKey = 0
    if ($keyName -match "^[A-Z]$") {
        $virtualKey = [int][char]$keyName
    } elseif ($keyName -match "^[0-9]$") {
        $virtualKey = [int][char]$keyName
    } elseif ($keyName -match "^F([1-9]|1[0-2])$") {
        $virtualKey = 0x70 + [int]$Matches[1] - 1
    } else {
        switch ($keyName) {
            "Enter" { $virtualKey = 0x0D }
            "Escape" { $virtualKey = 0x1B }
            "Delete" { $virtualKey = 0x2E }
            "Backspace" { $virtualKey = 0x08 }
            "Space" { $virtualKey = 0x20 }
            "ArrowLeft" { $virtualKey = 0x25 }
            "ArrowUp" { $virtualKey = 0x26 }
            "ArrowRight" { $virtualKey = 0x27 }
            "ArrowDown" { $virtualKey = 0x28 }
            "Home" { $virtualKey = 0x24 }
            "End" { $virtualKey = 0x23 }
            "PageUp" { $virtualKey = 0x21 }
            "PageDown" { $virtualKey = 0x22 }
            default { throw "Launcher hotkey '$canonicalBinding' has an unsupported key '$keyName'." }
        }
    }

    return [pscustomobject]@{
        Binding = $canonicalBinding
        Modifiers = [uint32]$modifiers
        VirtualKey = [uint32]$virtualKey
    }
}

function Assert-BabelShortcutCommandBindingOwnership {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandId,

        [Parameter(Mandatory = $true)]
        [string]$Binding
    )

    if ($Binding -eq "Escape" -and $CommandId -ne "cancel") {
        throw "Shortcut 'Escape' is reserved for cancel and fixed navigation behavior, not '$CommandId'."
    }
}

function ConvertTo-BabelShortcutBindingMap {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Definitions,

        [Parameter(Mandatory = $true)]
        [Collections.IDictionary]$Bindings
    )

    $knownIds = @{}
    $usedBindings = @{}
    $canonicalBindings = [ordered]@{}

    foreach ($definition in @($Definitions)) {
        $id = [string]$definition.Id
        $knownIds[$id] = $true
        $matchingBindingIds = @($Bindings.Keys | Where-Object { [string]$_ -ceq $id })
        if ($matchingBindingIds.Count -ne 1) {
            throw "Shortcut settings are missing binding '$id'."
        }

        $rawBinding = $Bindings[$id]
        if ($null -eq $rawBinding) {
            $canonicalBindings[$id] = $null
            continue
        }
        if (-not ($rawBinding -is [string])) {
            throw "Shortcut setting '$id' must be a string or null."
        }

        $canonicalBinding = ConvertTo-BabelShortcutBinding -Binding ([string]$rawBinding)
        Assert-BabelShortcutCommandBindingOwnership -CommandId $id -Binding $canonicalBinding
        $bindingKey = $canonicalBinding.ToUpperInvariant()
        if ($usedBindings.ContainsKey($bindingKey)) {
            throw "Shortcut '$canonicalBinding' is assigned to both '$($usedBindings[$bindingKey])' and '$id'."
        }

        $usedBindings[$bindingKey] = $id
        $canonicalBindings[$id] = $canonicalBinding
    }

    foreach ($bindingId in @($Bindings.Keys)) {
        if (@($knownIds.Keys) -cnotcontains [string]$bindingId) {
            throw "Shortcut settings contain unknown binding '$bindingId'."
        }
    }

    return $canonicalBindings
}

function Get-BabelShortcutDefinitions {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Shortcut defaults not found: $Path"
    }

    try {
        $document = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json
    } catch {
        throw "Shortcut defaults are not valid JSON: $($_.Exception.Message)"
    }

    Assert-BabelShortcutExactProperties `
        -InputObject $document `
        -Names @("schemaVersion", "commands") `
        -Description "Shortcut defaults"

    if (-not (Test-BabelShortcutProperty -InputObject $document -Name "schemaVersion")) {
        throw "Shortcut defaults are missing schemaVersion."
    }
    if (-not ($document.schemaVersion -is [int]) -or [int]$document.schemaVersion -ne 3) {
        throw "Unsupported shortcut defaults schemaVersion '$($document.schemaVersion)'."
    }
    if (-not (Test-BabelShortcutProperty -InputObject $document -Name "commands")) {
        throw "Shortcut defaults are missing commands."
    }

    $commands = @($document.commands)
    if ($commands.Count -eq 0) {
        throw "Shortcut defaults do not define any commands."
    }

    $ids = @{}
    $defaultBindings = [ordered]@{}
    $definitions = @()
    foreach ($command in $commands) {
        Assert-BabelShortcutExactProperties `
            -InputObject $command `
            -Names @("command", "label", "defaultBinding") `
            -Description "Shortcut command"
        foreach ($propertyName in @("command", "label", "defaultBinding")) {
            if (-not (Test-BabelShortcutProperty -InputObject $command -Name $propertyName)) {
                throw "Shortcut command is missing $propertyName."
            }
        }
        if (
            -not ($command.command -is [string]) -or
            -not ($command.label -is [string]) -or
            -not ($command.defaultBinding -is [string])
        ) {
            throw "Shortcut command properties must be strings."
        }

        $id = ([string]$command.command).Trim()
        $label = ([string]$command.label).Trim()
        if ($id -notmatch "^[a-z][a-zA-Z0-9]*$") {
            throw "Shortcut command id '$id' is invalid."
        }
        if ($ids.ContainsKey($id)) {
            throw "Shortcut defaults contain duplicate command id '$id'."
        }
        if ([string]::IsNullOrWhiteSpace($label)) {
            throw "Shortcut command '$id' has an empty label."
        }

        $ids[$id] = $true
        $defaultBindings[$id] = ConvertTo-BabelShortcutBinding -Binding ([string]$command.defaultBinding)
        $definitions += [pscustomobject]@{
            Id = $id
            Label = $label
            DefaultBinding = $defaultBindings[$id]
        }
    }

    [void](ConvertTo-BabelShortcutBindingMap -Definitions $definitions -Bindings $defaultBindings)
    return @($definitions)
}

function Get-BabelDefaultShortcutBindings {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Definitions
    )

    $bindings = [ordered]@{}
    foreach ($definition in @($Definitions)) {
        $bindings[[string]$definition.Id] = [string]$definition.DefaultBinding
    }
    return $bindings
}

function Test-BabelLegacyFixedNavigationBinding {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Binding
    )

    $tokens = @(
        $Binding.Split("+") | ForEach-Object {
            $token = $_.Trim().ToLowerInvariant()
            switch ($token) {
                "control" { "ctrl" }
                "up" { "arrowup" }
                "down" { "arrowdown" }
                default { $token }
            }
        }
    )
    if ($tokens.Count -ne 3 -or @($tokens | Select-Object -Unique).Count -ne 3) {
        return $false
    }
    return (
        $tokens -contains "ctrl" -and
        $tokens -contains "alt" -and
        (
            $tokens -contains "arrowup" -or
            $tokens -contains "arrowdown"
        )
    )
}

function Read-BabelShortcutSettings {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Definitions,

        [string]$Path = (Get-BabelShortcutSettingsPath)
    )

    $defaults = Get-BabelDefaultShortcutBindings -Definitions $Definitions
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        $warningMessage = "Shortcut settings were not found at '$Path'. Using defaults."
        Write-Warning $warningMessage
        return [pscustomobject]@{
            Bindings = $defaults
            Warning = $warningMessage
            Source = "Defaults"
        }
    }

    try {
        $document = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json
        Assert-BabelShortcutExactProperties `
            -InputObject $document `
            -Names @("schemaVersion", "bindings") `
            -Description "Shortcut settings"
        if (-not (Test-BabelShortcutProperty -InputObject $document -Name "schemaVersion")) {
            throw "Shortcut settings are missing schemaVersion."
        }
        if (
            -not ($document.schemaVersion -is [int]) -or
            (
                [int]$document.schemaVersion -ne 1 -and
                [int]$document.schemaVersion -ne 2 -and
                [int]$document.schemaVersion -ne 3
            )
        ) {
            throw "Unsupported shortcut settings schemaVersion '$($document.schemaVersion)'."
        }
        if (-not (Test-BabelShortcutProperty -InputObject $document -Name "bindings")) {
            throw "Shortcut settings are missing bindings."
        }
        if (-not ($document.bindings -is [Management.Automation.PSCustomObject])) {
            throw "Shortcut settings bindings must be a JSON object."
        }

        $currentCommandIds = @($Definitions | ForEach-Object { [string]$_.Id })
        $legacyCommandIds = @(
            "save",
            "new",
            "edit",
            "confirm",
            "cancel",
            "search",
            "delete",
            "commandPalette"
        )
        $versionTwoCommandIds = @(
            "save",
            "new",
            "edit",
            "read",
            "confirm",
            "cancel",
            "search",
            "delete",
            "commandPalette"
        )
        $expectedCommandIds = switch ([int]$document.schemaVersion) {
            1 { $legacyCommandIds }
            2 { $versionTwoCommandIds }
            default { $currentCommandIds }
        }
        Assert-BabelShortcutExactProperties `
            -InputObject $document.bindings `
            -Names $expectedCommandIds `
            -Description "Shortcut settings bindings"

        $bindings = [ordered]@{}
        foreach ($property in @($document.bindings.PSObject.Properties)) {
            if (
                $null -eq $property.Value -and
                [int]$document.schemaVersion -eq 3
            ) {
                $bindings[[string]$property.Name] = $null
                continue
            }
            if (-not ($property.Value -is [string])) {
                $expectedType = if ([int]$document.schemaVersion -eq 3) { "a string or null" } else { "a string" }
                throw "Shortcut setting '$($property.Name)' must be $expectedType."
            }
            $bindings[[string]$property.Name] = [string]$property.Value
        }

        if ([int]$document.schemaVersion -lt 3) {
            $usedBindings = @{}
            $legacyCanonicalBindings = [ordered]@{}
            foreach ($commandId in $expectedCommandIds) {
                $rawLegacyBinding = [string]$bindings[$commandId]
                if (Test-BabelLegacyFixedNavigationBinding -Binding $rawLegacyBinding) {
                    $legacyCanonicalBindings[$commandId] = $null
                    continue
                }
                $canonicalBinding = ConvertTo-BabelShortcutBinding -Binding $rawLegacyBinding
                if (
                    $canonicalBinding -eq "Escape" -and
                    $commandId -ne "cancel"
                ) {
                    $legacyCanonicalBindings[$commandId] = $null
                    continue
                }
                Assert-BabelShortcutCommandBindingOwnership `
                    -CommandId $commandId `
                    -Binding $canonicalBinding
                $bindingKey = $canonicalBinding.ToUpperInvariant()
                if ($usedBindings.ContainsKey($bindingKey)) {
                    throw "Shortcut '$canonicalBinding' is assigned to both '$($usedBindings[$bindingKey])' and '$commandId'."
                }
                $usedBindings[$bindingKey] = $commandId
                $legacyCanonicalBindings[$commandId] = $canonicalBinding
            }

            $migratedBindings = [ordered]@{}
            foreach ($definition in @($Definitions)) {
                $commandId = [string]$definition.Id
                if ($legacyCanonicalBindings.Contains($commandId)) {
                    $migratedBindings[$commandId] = $legacyCanonicalBindings[$commandId]
                    continue
                }

                $defaultBinding = [string]$defaults[$commandId]
                $bindingKey = $defaultBinding.ToUpperInvariant()
                if ($usedBindings.ContainsKey($bindingKey)) {
                    $migratedBindings[$commandId] = $null
                    continue
                }
                $usedBindings[$bindingKey] = $commandId
                $migratedBindings[$commandId] = $defaultBinding
            }
            $bindings = $migratedBindings
        }
        $canonicalBindings = ConvertTo-BabelShortcutBindingMap `
            -Definitions $Definitions `
            -Bindings $bindings

        return [pscustomobject]@{
            Bindings = $canonicalBindings
            Warning = $null
            Source = "User"
        }
    } catch {
        $warningMessage = "Shortcut settings at '$Path' are invalid. Using defaults. $($_.Exception.Message)"
        Write-Warning $warningMessage
        return [pscustomobject]@{
            Bindings = $defaults
            Warning = $warningMessage
            Source = "Defaults"
        }
    }
}

function Write-BabelShortcutSettings {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Definitions,

        [Parameter(Mandatory = $true)]
        [Collections.IDictionary]$Bindings,

        [string]$Path = (Get-BabelShortcutSettingsPath)
    )

    $canonicalBindings = ConvertTo-BabelShortcutBindingMap `
        -Definitions $Definitions `
        -Bindings $Bindings
    $fullPath = [IO.Path]::GetFullPath($Path)
    $directory = [IO.Path]::GetDirectoryName($fullPath)
    if ([string]::IsNullOrWhiteSpace($directory)) {
        throw "Shortcut settings path must include a directory."
    }
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $directory -Force)
    }

    $document = [ordered]@{
        schemaVersion = 3
        bindings = $canonicalBindings
    }
    $json = $document | ConvertTo-Json -Depth 4
    $operationId = [Guid]::NewGuid().ToString("N")
    $fileName = [IO.Path]::GetFileName($fullPath)
    $temporaryPath = Join-Path $directory ("." + $fileName + "." + $operationId + ".tmp")
    $backupPath = Join-Path $directory ("." + $fileName + "." + $operationId + ".bak")

    try {
        [IO.File]::WriteAllText(
            $temporaryPath,
            $json,
            (New-Object Text.UTF8Encoding($false))
        )
        if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
            [IO.File]::Replace($temporaryPath, $fullPath, $backupPath)
        } else {
            [IO.File]::Move($temporaryPath, $fullPath)
        }
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
        if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
            Remove-Item -LiteralPath $backupPath -Force
        }
    }

    return $fullPath
}

function Read-BabelLauncherHotkeySettings {
    param(
        [string]$Path = (Get-BabelLauncherHotkeySettingsPath)
    )

    $defaultBinding = Get-BabelDefaultLauncherHotkeyBinding
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{
            Binding = $defaultBinding
            Warning = $null
            Source = "Defaults"
        }
    }

    try {
        $document = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json
        Assert-BabelShortcutExactProperties `
            -InputObject $document `
            -Names @("schemaVersion", "toggleLauncher") `
            -Description "Launcher hotkey settings"
        if (-not ($document.schemaVersion -is [int]) -or [int]$document.schemaVersion -ne 1) {
            throw "Unsupported launcher hotkey schemaVersion '$($document.schemaVersion)'."
        }
        if (-not ($document.toggleLauncher -is [string])) {
            throw "Launcher hotkey toggleLauncher must be a string."
        }

        $registration = ConvertTo-BabelLauncherHotkeyRegistration `
            -Binding ([string]$document.toggleLauncher)
        return [pscustomobject]@{
            Binding = [string]$registration.Binding
            Warning = $null
            Source = "User"
        }
    } catch {
        $warningMessage = "Launcher hotkey settings at '$Path' are invalid. Using '$defaultBinding'. $($_.Exception.Message)"
        Write-Warning $warningMessage
        return [pscustomobject]@{
            Binding = $defaultBinding
            Warning = $warningMessage
            Source = "Defaults"
        }
    }
}

function Write-BabelLauncherHotkeySettings {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Binding,

        [string]$Path = (Get-BabelLauncherHotkeySettingsPath)
    )

    $registration = ConvertTo-BabelLauncherHotkeyRegistration -Binding $Binding
    $fullPath = [IO.Path]::GetFullPath($Path)
    $directory = [IO.Path]::GetDirectoryName($fullPath)
    if ([string]::IsNullOrWhiteSpace($directory)) {
        throw "Launcher hotkey settings path must include a directory."
    }
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $directory -Force)
    }

    $document = [ordered]@{
        schemaVersion = 1
        toggleLauncher = [string]$registration.Binding
    }
    $json = $document | ConvertTo-Json -Depth 3
    $operationId = [Guid]::NewGuid().ToString("N")
    $fileName = [IO.Path]::GetFileName($fullPath)
    $temporaryPath = Join-Path $directory ("." + $fileName + "." + $operationId + ".tmp")
    $backupPath = Join-Path $directory ("." + $fileName + "." + $operationId + ".bak")

    try {
        [IO.File]::WriteAllText(
            $temporaryPath,
            $json,
            (New-Object Text.UTF8Encoding($false))
        )
        if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
            [IO.File]::Replace($temporaryPath, $fullPath, $backupPath)
        } else {
            [IO.File]::Move($temporaryPath, $fullPath)
        }
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
        if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
            Remove-Item -LiteralPath $backupPath -Force
        }
    }

    return $fullPath
}
