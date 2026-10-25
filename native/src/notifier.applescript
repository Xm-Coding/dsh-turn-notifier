use framework "Foundation"
use scripting additions

on run
	set processArguments to current application's NSProcessInfo's processInfo's arguments
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
