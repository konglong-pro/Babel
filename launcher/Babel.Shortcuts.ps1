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

function ConvertTo-BabelShortcutStroke {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Binding,

        [switch]$AllowBareKeys
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
                "TAB" { $keyName = "Tab" }
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
        "Alt+Tab",
        "Alt+Shift+Tab",
        "Ctrl+Alt+Tab",
        "Ctrl+Alt+Shift+Tab",
        "F2"
    )
    if ($reservedBindings -contains $canonicalBinding) {
        throw "Shortcut '$canonicalBinding' is reserved by Windows or fixed Babel navigation."
    }
    $isBareFunctionKey = -not $hasCtrl -and -not $hasAlt -and -not $hasShift -and $keyName -match "^F([1-9]|1[0-2])$"
    if (
        -not $hasCtrl -and
        -not $hasAlt -and
        $canonicalBinding -ne "Escape" -and
        -not $isBareFunctionKey -and
        -not $AllowBareKeys
    ) {
        throw "Shortcut '$canonicalBinding' must include Ctrl or Alt. Only Escape or a safe bare function key may omit them."
    }

    return $canonicalBinding
}

function ConvertTo-BabelShortcutBinding {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Binding,
        [switch]$AllowBareKeys
    )
    # Spaces around a chord's + are cosmetic; spaces between chords are steps.
    if ($Binding -match '[^\S ]') { throw 'Shortcut steps must be separated by ordinary spaces.' }
    $normalized = ($Binding.Trim() -replace ' *\+ *', '+')
    if ([string]::IsNullOrWhiteSpace($normalized)) { throw 'A shortcut binding cannot be empty.' }
    $strokes = @($normalized -split ' +')
    if ($strokes.Count -gt 4) { throw 'A shortcut sequence can contain at most four steps.' }
    $canonical = @()
    for ($index = 0; $index -lt $strokes.Count; $index++) {
        $stroke = ConvertTo-BabelShortcutStroke -Binding $strokes[$index] -AllowBareKeys:($AllowBareKeys -or $index -gt 0)
        if ($strokes.Count -gt 1 -and ($stroke -split '\+')[-1] -eq 'Escape') {
            throw 'Escape cancels a pending shortcut and cannot be part of a sequence.'
        }
        $canonical += $stroke
    }
    return $canonical -join ' '
}

function Test-BabelDesktopOnlyShortcutBinding {
    param([Parameter(Mandatory = $true)][string]$Binding)

    $canonicalBinding = ConvertTo-BabelShortcutBinding -Binding $Binding -AllowBareKeys
    $desktopOnly = @(
        "Ctrl+W", "Ctrl+Shift+W", "Ctrl+T", "Ctrl+Shift+T", "Ctrl+L",
        "Ctrl+N", "Ctrl+Shift+N", "Ctrl+Tab", "Ctrl+Shift+Tab",
        "F5", "Ctrl+F5", "F6", "F11", "F12"
    )
    return @($canonicalBinding.Split(' ') | Where-Object { $desktopOnly -contains $_ }).Count -gt 0
}

function ConvertTo-BabelLauncherHotkeyRegistration {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Binding
    )

    $canonicalBinding = ConvertTo-BabelShortcutBinding -Binding $Binding
    if ($canonicalBinding.Contains(' ')) { throw 'The system-wide launcher hotkey must be a single key combination.' }
    if (Test-BabelDesktopOnlyShortcutBinding -Binding $canonicalBinding) {
        throw "Shortcut '$canonicalBinding' is available only inside the Babel desktop window, not as a global launcher hotkey."
    }
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
        [string]$Binding,

        [ValidateSet('global', 'app', 'edit', 'read', 'launcher')]
        [string]$Scope = 'global'
    )

    $escapeOwner = if ($Scope -eq 'launcher') { 'hideLauncher' } else { 'cancel' }
    if ($Binding -eq "Escape" -and $CommandId -ne $escapeOwner) {
        throw "Shortcut 'Escape' is reserved for $escapeOwner and fixed navigation behavior, not '$CommandId'."
    }
    $firstStroke = $Binding.Split(' ')[0]
    if ($Scope -in @('app', 'edit', 'read') -and $firstStroke -in @('Enter', 'Shift+Enter', 'Tab', 'Shift+Tab')) {
        throw "Shortcut '$Binding' is reserved for notebook structure and focus navigation."
    }
}

function ConvertTo-BabelShortcutBindingMap {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Definitions,

        [Parameter(Mandatory = $true)]
        [Collections.IDictionary]$Bindings,

        [ValidateSet('global', 'app', 'edit', 'read', 'launcher')]
        [string]$Scope = 'global',

        [switch]$Partial
    )

    $knownIds = @{}
    $usedBindings = @{}
    $canonicalBindings = [ordered]@{}

    foreach ($definition in @($Definitions)) {
        $id = [string]$definition.Id
        $knownIds[$id] = $true
        $matchingBindingIds = @($Bindings.Keys | Where-Object { [string]$_ -ceq $id })
        if ($Partial -and $matchingBindingIds.Count -eq 0) { continue }
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

        $canonicalBinding = ConvertTo-BabelShortcutBinding -Binding ([string]$rawBinding) -AllowBareKeys:($Scope -ne 'global')
        Assert-BabelShortcutCommandBindingOwnership -CommandId $id -Binding $canonicalBinding -Scope $Scope
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

    Assert-BabelShortcutPrefixConflicts -Bindings $canonicalBindings -Scope $Scope
    return $canonicalBindings
}

function Assert-BabelShortcutPrefixConflicts {
    param([Parameter(Mandatory = $true)][Collections.IDictionary]$Bindings, [string]$Scope = 'global')
    $ids = @($Bindings.Keys | Where-Object { $null -ne $Bindings[$_] })
    for ($index = 0; $index -lt $ids.Count; $index++) {
        for ($other = $index + 1; $other -lt $ids.Count; $other++) {
            $first = [string]$Bindings[$ids[$index]]
            $second = [string]$Bindings[$ids[$other]]
            if ($first.StartsWith($second + ' ', [StringComparison]::OrdinalIgnoreCase) -or
                $second.StartsWith($first + ' ', [StringComparison]::OrdinalIgnoreCase)) {
                throw "Shortcut '$first' ($($ids[$index])) conflicts with prefix '$second' ($($ids[$other])) in the '$Scope' layer. Rebind or disable the shorter command first."
            }
        }
    }
}

function Assert-BabelEffectiveShortcutPrefixes {
    param([Parameter(Mandatory = $true)][Collections.IDictionary]$Bindings,
        [Parameter(Mandatory = $true)][Collections.IDictionary]$Layers)
    foreach ($scope in @('global', 'app', 'edit', 'read', 'launcher')) {
        $effective = Get-BabelEffectiveShortcutBindings -Bindings $Bindings -Layers $Layers -Scope $scope
        Assert-BabelShortcutPrefixConflicts -Bindings $effective -Scope $scope
    }
}

function Get-BabelShortcutDefinitions {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [ValidateSet('global', 'launcher')]
        [string]$Scope = 'global'
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
        -Names @("schemaVersion", "commands", "layers", "launcherCommands") `
        -Description "Shortcut defaults"

    if (-not (Test-BabelShortcutProperty -InputObject $document -Name "schemaVersion")) {
        throw "Shortcut defaults are missing schemaVersion."
    }
    if (-not ($document.schemaVersion -is [int] -or $document.schemaVersion -is [long]) -or [long]$document.schemaVersion -ne 7) {
        throw "Unsupported shortcut defaults schemaVersion '$($document.schemaVersion)'."
    }
    if (-not (Test-BabelShortcutProperty -InputObject $document -Name "commands")) {
        throw "Shortcut defaults are missing commands."
    }

    $commands = if ($Scope -eq 'launcher') { @($document.launcherCommands) } else { @($document.commands) }
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
            ($null -ne $command.defaultBinding -and -not ($command.defaultBinding -is [string]))
        ) {
            throw "Shortcut command id and label must be strings; defaultBinding must be a string or null."
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
        $defaultBindings[$id] = if ($null -eq $command.defaultBinding) { $null } else {
            ConvertTo-BabelShortcutBinding -Binding ([string]$command.defaultBinding) -AllowBareKeys:($Scope -eq 'launcher')
        }
        $definitions += [pscustomobject]@{
            Id = $id
            Label = $label
            DefaultBinding = $defaultBindings[$id]
        }
    }

    [void](ConvertTo-BabelShortcutBindingMap -Definitions $definitions -Bindings $defaultBindings -Scope $Scope)
    return @($definitions)
}

function Get-BabelLauncherShortcutDefinitions {
    param([string]$Path = (Join-Path $PSScriptRoot '../packages/platform/shortcuts.defaults.json'))
    return @(Get-BabelShortcutDefinitions -Path $Path -Scope launcher)
}

function Get-BabelDefaultShortcutLayers {
    param([object[]]$LauncherDefinitions = @(Get-BabelLauncherShortcutDefinitions))
    $document = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../packages/platform/shortcuts.defaults.json') -Raw | ConvertFrom-Json
    return [ordered]@{
        app = ConvertTo-BabelShortcutDictionary -Value $document.layers.app -Description 'Default APP layer'
        edit = ConvertTo-BabelShortcutDictionary -Value $document.layers.edit -Description 'Default edit layer'
        read = ConvertTo-BabelShortcutDictionary -Value $document.layers.read -Description 'Default read layer'
        launcher = Get-BabelDefaultShortcutBindings -Definitions $LauncherDefinitions
    }
}

function ConvertTo-BabelShortcutDictionary {
    param([AllowNull()][object]$Value, [string]$Description)
    if ($Value -is [Collections.IDictionary]) { return $Value }
    if ($Value -isnot [Management.Automation.PSCustomObject]) { throw "$Description must be a JSON object." }
    $result = [ordered]@{}
    foreach ($property in $Value.PSObject.Properties) { $result[$property.Name] = $property.Value }
    return $result
}

function ConvertTo-BabelShortcutLayers {
    param(
        [Parameter(Mandatory = $true)][object[]]$Definitions,
        [Parameter(Mandatory = $true)][object]$Layers,
        [object[]]$LauncherDefinitions = @(Get-BabelLauncherShortcutDefinitions)
    )
    $layerMap = ConvertTo-BabelShortcutDictionary -Value $Layers -Description 'Shortcut layers'
    $expected = @('app', 'edit', 'read', 'launcher')
    if ($layerMap.Count -ne 4 -or @($expected | Where-Object { @($layerMap.Keys) -cnotcontains $_ }).Count -gt 0) {
        throw 'Shortcut layers must contain exactly: app, edit, read, launcher.'
    }
    $result = [ordered]@{}
    foreach ($scope in $expected) {
        $map = ConvertTo-BabelShortcutDictionary -Value $layerMap[$scope] -Description "Shortcut layer '$scope'"
        $scopeDefinitions = if ($scope -eq 'launcher') { $LauncherDefinitions } else { $Definitions }
        $result[$scope] = ConvertTo-BabelShortcutBindingMap -Definitions $scopeDefinitions -Bindings $map `
            -Scope $scope -Partial:($scope -ne 'launcher')
    }
    return $result
}

function Get-BabelEffectiveShortcutBindings {
    param(
        [Parameter(Mandatory = $true)][Collections.IDictionary]$Bindings,
        [Parameter(Mandatory = $true)][Collections.IDictionary]$Layers,
        [ValidateSet('global', 'app', 'edit', 'read', 'launcher')][string]$Scope = 'global',
        [switch]$IncludeOrigins
    )
    $result = [ordered]@{}
    $origins = [ordered]@{}
    if ($Scope -eq 'launcher') {
        foreach ($key in $Layers.launcher.Keys) {
            $result[$key] = $Layers.launcher[$key]
            $origins[$key] = [pscustomobject]@{ Scope = 'launcher'; ClaimedBy = $null }
        }
        if ($IncludeOrigins) { return [pscustomobject]@{ Bindings = $result; Origins = $origins } }
        return $result
    }
    foreach ($key in $Bindings.Keys) {
        $result[$key] = $Bindings[$key]
        $origins[$key] = [pscustomobject]@{ Scope = 'global'; ClaimedBy = $null }
    }
    $scopes = switch ($Scope) { 'app' { @('app') }; 'edit' { @('app', 'edit') }; 'read' { @('app', 'read') }; default { @() } }
    foreach ($layerScope in $scopes) {
        foreach ($key in $Layers[$layerScope].Keys) {
            $binding = $Layers[$layerScope][$key]
            if ($null -ne $binding) {
                foreach ($other in @($result.Keys)) {
                    if ($other -cne $key -and $result[$other] -ceq $binding) {
                        $result[$other] = $null
                        $origins[$other] = [pscustomobject]@{ Scope = $layerScope; ClaimedBy = $key }
                    }
                }
            }
            $result[$key] = $binding
            $origins[$key] = [pscustomobject]@{ Scope = $layerScope; ClaimedBy = $null }
        }
    }
    if ($IncludeOrigins) { return [pscustomobject]@{ Bindings = $result; Origins = $origins } }
    return $result
}

function Assert-BabelShortcutHotkeyConflict {
    param(
        [Parameter(Mandatory = $true)][Collections.IDictionary]$Bindings,
        [Parameter(Mandatory = $true)][Collections.IDictionary]$Layers,
        [Parameter(Mandatory = $true)][string]$LauncherBinding
    )
    foreach ($scope in @('global', 'app', 'edit', 'read', 'launcher')) {
        $effective = Get-BabelEffectiveShortcutBindings -Bindings $Bindings -Layers $Layers -Scope $scope
        foreach ($key in $effective.Keys) {
            if ($null -ne $effective[$key] -and @(([string]$effective[$key]).Split(' ') | Where-Object {
                [string]::Equals($_, $LauncherBinding, [StringComparison]::OrdinalIgnoreCase)
            }).Count -gt 0) {
                throw "Hotkey '$LauncherBinding' is already assigned to '$key' in the '$scope' layer."
            }
        }
    }
}

function Get-BabelLauncherShortcutCommand {
    param(
        [Parameter(Mandatory = $true)][Collections.IDictionary]$Bindings,
        [Parameter(Mandatory = $true)][string]$Binding
    )
    foreach ($command in $Bindings.Keys) {
        if ($null -ne $Bindings[$command] -and [string]::Equals($Bindings[$command], $Binding, [StringComparison]::OrdinalIgnoreCase)) {
            return [string]$command
        }
    }
    return $null
}

function New-BabelShortcutSequenceState {
    return [pscustomobject]@{ Pending = ''; ExpiresAt = [long]0 }
}

function Reset-BabelShortcutSequenceState {
    param([Parameter(Mandatory = $true)][object]$State)
    $State.Pending = ''
    $State.ExpiresAt = [long]0
}

function Step-BabelShortcutSequence {
    param(
        [Parameter(Mandatory = $true)][object]$State,
        [Parameter(Mandatory = $true)][Collections.IDictionary]$Bindings,
        [Parameter(Mandatory = $true)][string]$Binding,
        [long]$NowMilliseconds = [Environment]::TickCount64,
        [switch]$IsRepeat
    )
    if ($State.Pending -and $NowMilliseconds -ge $State.ExpiresAt) { Reset-BabelShortcutSequenceState -State $State }
    $hadPending = -not [string]::IsNullOrEmpty($State.Pending)
    if ($hadPending -and $Binding -eq 'Escape') {
        Reset-BabelShortcutSequenceState -State $State
        return [pscustomobject]@{ Consumed = $true; Command = $null; Pending = ''; Status = 'cancelled' }
    }
    if ($hadPending -and $IsRepeat) {
        return [pscustomobject]@{ Consumed = $true; Command = $null; Pending = $State.Pending; Status = 'repeat' }
    }
    $candidate = if ($hadPending) { $State.Pending + ' ' + $Binding } else { $Binding }
    $command = Get-BabelLauncherShortcutCommand -Bindings $Bindings -Binding $candidate
    if ($null -ne $command) {
        Reset-BabelShortcutSequenceState -State $State
        return [pscustomobject]@{ Consumed = $true; Command = $command; Pending = ''; Status = 'complete' }
    }
    $hasContinuation = @($Bindings.Values | Where-Object {
        $null -ne $_ -and ([string]$_).StartsWith($candidate + ' ', [StringComparison]::OrdinalIgnoreCase)
    }).Count -gt 0
    if ($hasContinuation -and -not $IsRepeat) {
        $State.Pending = $candidate
        $State.ExpiresAt = $NowMilliseconds + 1500
        return [pscustomobject]@{ Consumed = $true; Command = $null; Pending = $candidate; Status = 'pending' }
    }
    Reset-BabelShortcutSequenceState -State $State
    return [pscustomobject]@{ Consumed = ($hadPending -or $hasContinuation); Command = $null; Pending = ''; Status = 'unmatched' }
}

function Get-BabelDefaultShortcutBindings {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Definitions
    )

    $bindings = [ordered]@{}
    foreach ($definition in @($Definitions)) {
        $bindings[[string]$definition.Id] = $definition.DefaultBinding
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

function Test-BabelMigrationBindingAvailable {
    param([Collections.IDictionary]$Bindings, [Collections.IDictionary]$Layers,
        [string]$Command, [AllowNull()][string]$Binding, [string[]]$IgnoreCommands = @())
    if ([string]::IsNullOrEmpty($Binding)) { return $true }
    foreach ($map in @($Bindings, $Layers.app, $Layers.edit, $Layers.read)) {
        foreach ($id in $map.Keys) {
            if ($id -ceq $Command -or $IgnoreCommands -ccontains $id -or $null -eq $map[$id]) { continue }
            $other = [string]$map[$id]
            if ($Binding -ceq $other -or $Binding.StartsWith($other + ' ', [StringComparison]::Ordinal) -or
                $other.StartsWith($Binding + ' ', [StringComparison]::Ordinal)) { return $false }
        }
    }
    return $true
}

function Update-BabelNavigationShortcutDefaults {
    param([Collections.IDictionary]$Bindings, [Collections.IDictionary]$Layers, [object[]]$Definitions)
    if ($Bindings.closeTab -ceq 'Ctrl+Alt+W' -and
        (Test-BabelMigrationBindingAvailable -Bindings $Bindings -Layers $Layers -Command closeTab -Binding 'Ctrl+W')) {
        $Bindings.closeTab = 'Ctrl+W'
    }
    foreach ($definition in @($Definitions | Select-Object -Skip 18)) {
        $id = [string]$definition.Id
        if (Test-BabelMigrationBindingAvailable -Bindings $Bindings -Layers $Layers -Command $id -Binding $definition.DefaultBinding) {
            $Bindings[$id] = $definition.DefaultBinding
        }
    }
    $newLayers = Get-BabelDefaultShortcutLayers
    foreach ($id in @('focusFolders', 'focusDocuments', 'focusContent')) {
        $binding = $newLayers.app[$id]
        if (-not $Layers.app.Contains($id) -and
            (Test-BabelMigrationBindingAvailable -Bindings $Bindings -Layers $Layers -Command $id -Binding $binding)) {
            $Layers.app[$id] = $binding
            if (-not $Layers.edit.Contains($id)) { $Layers.edit[$id] = $null }
        }
    }
    $editBindings = Get-BabelEffectiveShortcutBindings -Bindings $Bindings -Layers $Layers -Scope edit
    if (-not $Layers.edit.Contains('saveAndRead') -and $editBindings.confirm -ceq 'Ctrl+Enter' -and
        (Test-BabelMigrationBindingAvailable -Bindings $Bindings -Layers $Layers -Command saveAndRead -Binding 'Ctrl+Enter' -IgnoreCommands @('confirm'))) {
        $Layers.edit.saveAndRead = 'Ctrl+Enter'
    }
}

function Read-BabelShortcutSettings {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Definitions,

        [string]$Path = (Get-BabelShortcutSettingsPath)
    )

    $defaults = Get-BabelDefaultShortcutBindings -Definitions $Definitions
    $defaultLayers = Get-BabelDefaultShortcutLayers
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        $warningMessage = "Shortcut settings were not found at '$Path'. Using defaults."
        Write-Warning $warningMessage
        return [pscustomobject]@{
            Bindings = $defaults
            Layers = $defaultLayers
            Warning = $warningMessage
            Source = "Defaults"
        }
    }

    try {
        $document = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json
        if (-not (Test-BabelShortcutProperty -InputObject $document -Name "schemaVersion")) {
            throw "Shortcut settings are missing schemaVersion."
        }
        if (
            -not ($document.schemaVersion -is [int] -or $document.schemaVersion -is [long]) -or
            (
                [long]$document.schemaVersion -ne 1 -and
                [long]$document.schemaVersion -ne 2 -and
                [long]$document.schemaVersion -ne 3 -and
                [long]$document.schemaVersion -ne 4 -and
                [long]$document.schemaVersion -ne 5 -and
                [long]$document.schemaVersion -ne 6 -and
                [long]$document.schemaVersion -ne 7
            )
        ) {
            throw "Unsupported shortcut settings schemaVersion '$($document.schemaVersion)'."
        }
        $settingsKeys = if ([long]$document.schemaVersion -ge 5) { @('schemaVersion', 'bindings', 'layers') } else { @('schemaVersion', 'bindings') }
        Assert-BabelShortcutExactProperties -InputObject $document -Names $settingsKeys -Description 'Shortcut settings'
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
        $versionThreeCommandIds = @(
            "save",
            "new",
            "edit",
            "read",
            "confirm",
            "cancel",
            "search",
            "delete",
            "commandPalette",
            "focusNextPane",
            "focusPreviousPane",
            "nextTab",
            "previousTab",
            "closeTab",
            "quickOpen",
            "help"
        )
        $expectedCommandIds = switch ([long]$document.schemaVersion) {
            1 { $legacyCommandIds }
            2 { $versionTwoCommandIds }
            3 { $versionThreeCommandIds }
            { $_ -in @(4, 5, 6) } { @($currentCommandIds | Select-Object -First 18) }
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
                [long]$document.schemaVersion -ge 3
            ) {
                $bindings[[string]$property.Name] = $null
                continue
            }
            if (-not ($property.Value -is [string])) {
                $expectedType = if ([long]$document.schemaVersion -ge 3) { "a string or null" } else { "a string" }
                throw "Shortcut setting '$($property.Name)' must be $expectedType."
            }
            # Older schemas allowed whitespace around a chord's +. Normalize with
            # their single-stroke parser before applying the v6 sequence grammar.
            $bindings[[string]$property.Name] = if ([long]$document.schemaVersion -ge 3 -and [long]$document.schemaVersion -lt 6) {
                ConvertTo-BabelShortcutStroke -Binding ([string]$property.Value)
            } else { [string]$property.Value }
        }

        if ([long]$document.schemaVersion -lt 4) {
            $usedBindings = @{}
            $legacyCanonicalBindings = [ordered]@{}
            foreach ($commandId in $expectedCommandIds) {
                if ($null -eq $bindings[$commandId]) {
                    $legacyCanonicalBindings[$commandId] = $null
                    continue
                }
                $rawLegacyBinding = [string]$bindings[$commandId]
                if (
                    [long]$document.schemaVersion -lt 3 -and
                    (Test-BabelLegacyFixedNavigationBinding -Binding $rawLegacyBinding)
                ) {
                    $legacyCanonicalBindings[$commandId] = $null
                    continue
                }
                $canonicalBinding = ConvertTo-BabelShortcutStroke -Binding $rawLegacyBinding
                if (
                    [long]$document.schemaVersion -lt 3 -and
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
            foreach ($definition in @($Definitions | Select-Object -First 18)) {
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
        if ([long]$document.schemaVersion -lt 7) {
            foreach ($definition in @($Definitions | Select-Object -Skip 18)) { $bindings[[string]$definition.Id] = $null }
        }
        $canonicalBindings = ConvertTo-BabelShortcutBindingMap `
            -Definitions $Definitions `
            -Bindings $bindings
        $canonicalLayers = if ([long]$document.schemaVersion -ge 5) {
            $rawLayers = $document.layers
            if ([long]$document.schemaVersion -eq 5) {
                $rawLayers = ConvertTo-BabelShortcutDictionary -Value $rawLayers -Description 'Shortcut layers'
                foreach ($scope in @($rawLayers.Keys)) {
                    $legacyLayer = ConvertTo-BabelShortcutDictionary -Value $rawLayers[$scope] -Description "Shortcut layer '$scope'"
                    foreach ($id in @($legacyLayer.Keys)) {
                        if ($legacyLayer[$id] -is [string]) {
                            $legacyLayer[$id] = ConvertTo-BabelShortcutStroke -Binding $legacyLayer[$id] -AllowBareKeys
                        }
                    }
                    $rawLayers[$scope] = $legacyLayer
                }
            }
            $layerDefinitions = if ([long]$document.schemaVersion -lt 7) { @($Definitions | Select-Object -First 18) } else { $Definitions }
            ConvertTo-BabelShortcutLayers -Definitions $layerDefinitions -Layers $rawLayers
        } else {
            [ordered]@{ app = [ordered]@{}; edit = [ordered]@{}; read = [ordered]@{}; launcher = $defaultLayers.launcher }
        }
        if ([long]$document.schemaVersion -lt 6) {
            $allBindings = @($canonicalBindings.Values)
            foreach ($scope in @('app', 'edit', 'read', 'launcher')) { $allBindings += @($canonicalLayers[$scope].Values) }
            if (@($allBindings | Where-Object { $null -ne $_ -and ([string]$_).Contains(' ') }).Count -gt 0) {
                throw 'Shortcut sequences require schemaVersion 6.'
            }
        }
        Assert-BabelEffectiveShortcutPrefixes -Bindings $canonicalBindings -Layers $canonicalLayers
        if ([long]$document.schemaVersion -lt 7) {
            Update-BabelNavigationShortcutDefaults -Bindings $canonicalBindings -Layers $canonicalLayers -Definitions $Definitions
            Assert-BabelEffectiveShortcutPrefixes -Bindings $canonicalBindings -Layers $canonicalLayers
        }

        return [pscustomobject]@{
            Bindings = $canonicalBindings
            Layers = $canonicalLayers
            Warning = $null
            Source = "User"
        }
    } catch {
        $warningMessage = "Shortcut settings at '$Path' are invalid. Using defaults. $($_.Exception.Message)"
        Write-Warning $warningMessage
        return [pscustomobject]@{
            Bindings = $defaults
            Layers = $defaultLayers
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

        [string]$Path = (Get-BabelShortcutSettingsPath),

        [AllowNull()][Collections.IDictionary]$Layers = $null
    )

    $canonicalBindings = ConvertTo-BabelShortcutBindingMap `
        -Definitions $Definitions `
        -Bindings $Bindings
    if ($null -eq $Layers) { $Layers = Get-BabelDefaultShortcutLayers }
    $canonicalLayers = ConvertTo-BabelShortcutLayers -Definitions $Definitions -Layers $Layers
    Assert-BabelEffectiveShortcutPrefixes -Bindings $canonicalBindings -Layers $canonicalLayers
    $fullPath = [IO.Path]::GetFullPath($Path)
    $directory = [IO.Path]::GetDirectoryName($fullPath)
    if ([string]::IsNullOrWhiteSpace($directory)) {
        throw "Shortcut settings path must include a directory."
    }
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $directory -Force)
    }

    $document = [ordered]@{
        schemaVersion = 7
        bindings = $canonicalBindings
        layers = $canonicalLayers
    }
    $json = $document | ConvertTo-Json -Depth 6
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
        if (-not ($document.schemaVersion -is [int] -or $document.schemaVersion -is [long]) -or [long]$document.schemaVersion -ne 1) {
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
