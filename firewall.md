# Allowing an Application Through Windows Defender Firewall via Command Line

This guide explains how to create an inbound firewall rule on Windows to allow network traffic to your application (e.g., the ESC/POS Printer Emulator listening on TCP port 9100). This is often necessary when the application needs to accept connections from other computers on your local network.

## Why is this needed?

Windows Defender Firewall, by default, blocks unsolicited incoming network connections to applications to protect your computer. When you run a server application (like our emulator listening on a specific port), you need to tell the firewall to allow other devices on the network to connect to it.

## Administrator Privileges Required

Modifying firewall rules is a system-level operation that can affect your computer's security. Therefore, these commands **must be run with administrator privileges**.

**How to open Command Prompt or PowerShell as an Administrator:**

1.  **Press the `Windows` key** on your keyboard.
2.  Type `cmd` (for Command Prompt) or `powershell` (for Windows PowerShell).
3.  In the search results, **right-click** on "Command Prompt" or "Windows PowerShell".
4.  Select "**Run as administrator**" from the context menu.
    *   Hotkey combination: You can often select the item in the search results and press **`Ctrl + Shift + Enter`** to try and run it as an administrator.
5.  If prompted by User Account Control (UAC), click "Yes" to allow the application to make changes.

## Creating the Firewall Rule

You can use either Command Prompt (CMD) or PowerShell. Choose one method.

### Method 1: Using Command Prompt (CMD)

Open Command Prompt **as an administrator** and run the following command:

netsh advfirewall firewall add rule name="ESC/POS Emulator (TCP 9100)" dir=in action=allow protocol=TCP localport=9100