import os
import time
import random
import praw
from prawcore.exceptions import NotFound, Forbidden

# Initialize Reddit API client using environment variables
# Original values were: client_id="YOUR_CLIENT_ID", client_secret="YOUR_CLIENT_SECRET"
reddit = praw.Reddit(
    client_id=os.environ.get("REDDIT_CLIENT_ID"),
    client_secret=os.environ.get("REDDIT_CLIENT_SECRET"),
    user_agent="Raffle script by u/uk_uk"
)

def run_raffle(submission_url, required_keyword=None, min_age_days=0, min_karma=0, image_mode="any", excluded_users=None):
    # Fetch the submission via URL
    submission = reddit.submission(url=submission_url)
    
    # Load all comments, ignoring "More Comments" objects to avoid errors
    submission.comments.replace_more(limit=0)
    
    valid_entries = []
    
    # Ensure excluded_users is a list to prevent iteration errors
    if excluded_users is None:
        excluded_users = []
        
    # Convert excluded users to lowercase for case-insensitive comparison
    excluded_users_lower = [user.lower() for user in excluded_users]
    
    # Get current time for account age calculation
    current_time = time.time()
    
    # Iterate through all top-level comments
    for comment in submission.comments:
        # Skip deleted comments or comments without an author
        if comment.author is None:
            continue
            
        author_name = comment.author.name
        
        # 1. Filter: Exclude specific usernames 
        if author_name.lower() in excluded_users_lower:
            continue
            
        # Try block required because accessing user attributes of shadowbanned or deleted accounts throws an error
        try:
            # 2. Filter: Minimum account age in days
            account_age_days = (current_time - comment.author.created_utc) / 86400
            if account_age_days < min_age_days:
                continue
                
            # 3. Filter: Minimum karma requirement
            if comment.author.comment_karma < min_karma:
                continue
                
        except (NotFound, Forbidden, AttributeError):
            # Skip user if their profile is not accessible
            continue
            
        # 4. Filter: Image requirement
        # Reddit typically embeds images with markdown tags like ![img](...) or ![gif](...)
        has_image = "![img](" in comment.body or "![gif](" in comment.body
        
        if image_mode == "only_image" and not has_image:
            continue
        if image_mode == "no_image" and has_image:
            continue
            
        # 5. Filter: Required keyword
        if required_keyword:
            if required_keyword.lower() in comment.body.lower():
                valid_entries.append(author_name)
        else:
            valid_entries.append(author_name)
            
    # Remove duplicates to ensure each user only has one entry
    unique_entries = list(set(valid_entries))
    
    # Check if there are any valid entries before drawing a winner
    if not unique_entries:
        return "No valid entries found."
        
    # Select a random winner from the filtered list
    winner = random.choice(unique_entries)
    return winner

# Configuration for the raffle run
target_url = "https://www.reddit.com/r/..."
mods_to_exclude = ["AutoModerator", "uk_uk"]

winner_name = run_raffle(
    submission_url=target_url,
    required_keyword="teilnahme",
    min_age_days=30,           
    min_karma=100,             
    image_mode="any",          # Options: "any", "only_image", "no_image"
    excluded_users=mods_to_exclude
)

print(f"The winner is: {winner_name}")
