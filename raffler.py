import os
import time
import random
import praw
from prawcore.exceptions import NotFound, Forbidden

# Initialize Reddit API client using environment variables
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

# Configuration for the raffle run using GitHub Actions inputs
target_url = os.environ.get("INPUT_URL")
keyword = os.environ.get("INPUT_KEYWORD", "")

# Convert strings from GitHub UI to integers
try:
    min_age = int(os.environ.get("INPUT_MIN_AGE", 0))
except ValueError:
    min_age = 0
    
try:
    min_karma = int(os.environ.get("INPUT_MIN_KARMA", 0))
except ValueError:
    min_karma = 0

image_mode = os.environ.get("INPUT_IMAGE_MODE", "any")

# Add usernames to exclude, e.g., moderators or the script owner
mods_to_exclude = ["AutoModerator", "uk_uk"]

# Only pass a string to required_keyword if it is not empty
final_keyword = keyword if keyword.strip() != "" else None

winner_name = run_raffle(
    submission_url=target_url,
    required_keyword=final_keyword,
    min_age_days=min_age,           
    min_karma=min_karma,             
    image_mode=image_mode,          
    excluded_users=mods_to_exclude
)

print(f"The winner is: {winner_name}")
