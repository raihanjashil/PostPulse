BRAND_PROFILE = {
    "name": "Stars of Science",
    "description": "a MENA science innovation TV show based in Qatar",
    "audience_note": "a Gulf-based, bilingual (Arabic/English) audience of science and innovation enthusiasts",
}

# Target personas the show's content team writes for (from the SoS brief:
# applicants, viewers, sponsors). Woven into the scoring prompt.
PERSONAS = {
    "general": {
        "label": "General Audience",
        "desc": "the general bilingual MENA public interested in science and the show",
    },
    "applicants": {
        "label": "Potential Applicants",
        "desc": (
            "young Arab innovators and STEM students/professionals aged 18-35 deciding whether to APPLY to the show; "
            "they respond to ambition, peer success stories, prize/credibility signals, and a clear application CTA"
        ),
    },
    "viewers": {
        "label": "Viewers & Fans",
        "desc": (
            "the general MENA audience who watch the show for entertainment and inspiration; "
            "they respond to drama, contestant personalities, episode moments, and tune-in CTAs"
        ),
    },
    "sponsors": {
        "label": "Sponsors & Partners",
        "desc": (
            "corporate and institutional decision-makers evaluating the show's reach, credibility, and social impact; "
            "they respond to professional tone, impact numbers, and brand-safe messaging"
        ),
    },
}
