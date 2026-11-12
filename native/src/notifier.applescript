use framework "Foundation"
use scripting additions

on run
	set processArguments to current application's NSProcessInfo's processInfo's arguments
	-- Clicking a notification in Notification Center can activate this applet
	-- without arguments. Bring Harness to the front instead of indexing past
	-- the end of the argument list and showing an AppleScript error.
	if (count of processArguments) < 5 then
		try
			open location "dsh://open"
		end try
		return
	end if
	set notificationTitle to (processArguments's objectAtIndex:1) as text
	set notificationSubtitle to (processArguments's objectAtIndex:2) as text
	set notificationBody to (processArguments's objectAtIndex:3) as text
	set soundName to (processArguments's objectAtIndex:4) as text
	if soundName is "" then
		display notification notificationBody with title notificationTitle subtitle notificationSubtitle
	else
		display notification notificationBody with title notificationTitle subtitle notificationSubtitle sound name soundName
	end if
end run
