import {
  Html, Head, Body, Container, Section, Row, Column,
  Heading, Text, Link, Img, Hr, Preview,
} from "@react-email/components";

export default function WeeklyDigest({
  subject = "This Week on Calvary Scribblings",
  intro = "Here's what's been published this week — stories worth your time.",
  stories = [],
  issueNumber = 1,
  unsubscribeUrl = "https://calvary-newsletter.calvarymediauk.workers.dev/unsubscribe?token=TOKEN",
}) {
  const siteUrl = "https://calvaryscribblings.co.uk";
  const purple = "#6b2fad";
  const lightPurple = "#f3eefb";
  const darkText = "#1a1a2e";
  const mutedText = "#666680";

  return (
    <Html lang="en">
      <Head />
      <Preview>{subject}</Preview>
      <Body style={{ backgroundColor: "#f8f7fc", fontFamily: "Georgia, 'Times New Roman', serif", margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: "620px", margin: "0 auto", backgroundColor: "#ffffff" }}>
          <Section style={{ backgroundColor: purple, padding: "36px 40px 28px", textAlign: "center" }}>
            <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: "11px", letterSpacing: "3px", textTransform: "uppercase", margin: "0 0 10px", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
              Issue #{issueNumber} · Weekly Digest
            </Text>
            <Heading style={{ color: "#ffffff", fontSize: "30px", fontWeight: "700", margin: "0 0 6px", fontFamily: "Georgia, 'Times New Roman', serif", letterSpacing: "-0.5px" }}>
              Calvary Scribblings
            </Heading>
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: "13px", margin: 0, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", letterSpacing: "1px" }}>
              Stories that stay with you.
            </Text>
          </Section>
          <Section style={{ padding: "36px 40px 24px" }}>
            <Text style={{ color: darkText, fontSize: "16px", lineHeight: "1.75", margin: 0 }}>{intro}</Text>
          </Section>
          <Hr style={{ borderColor: "#ede8f5", margin: "0 40px" }} />
          {stories.length > 0 ? (
            <Section style={{ padding: "24px 40px 0" }}>
              <Text style={{ color: purple, fontSize: "10px", letterSpacing: "3px", textTransform: "uppercase", margin: "0 0 24px", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: "700" }}>
                This Week's Stories
              </Text>
              {stories.map((story, i) => (
                <Row key={story.slug} style={{ marginBottom: "28px", paddingBottom: "28px", borderBottom: i < stories.length - 1 ? "1px solid #ede8f5" : "none" }}>
                  {story.cover && (
                    <Column style={{ width: "120px", verticalAlign: "top" }}>
                      <Link href={`${siteUrl}/stories/${story.slug}`}>
                        <Img src={story.cover} width="110" height="70" alt={story.title} style={{ borderRadius: "6px", objectFit: "cover", display: "block" }} />
                      </Link>
                    </Column>
                  )}
                  <Column style={{ verticalAlign: "top", paddingLeft: story.cover ? "16px" : "0" }}>
                    <Text style={{ color: purple, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", margin: "0 0 6px", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: "600" }}>
                      {story.category || "Fiction"}
                    </Text>
                    <Link href={`${siteUrl}/stories/${story.slug}`} style={{ textDecoration: "none" }}>
                      <Heading as="h2" style={{ color: darkText, fontSize: "17px", fontWeight: "700", margin: "0 0 6px", lineHeight: "1.3", fontFamily: "Georgia, 'Times New Roman', serif" }}>
                        {story.title}
                      </Heading>
                    </Link>
                    <Text style={{ color: mutedText, fontSize: "12px", margin: "0 0 8px", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
                      by {story.author}
                    </Text>
                    {story.excerpt && (
                      <Text style={{ color: "#444460", fontSize: "13px", lineHeight: "1.6", margin: "0 0 10px" }}>
                        {story.excerpt.length > 120 ? story.excerpt.slice(0, 120) + "…" : story.excerpt}
                      </Text>
                    )}
                    <Link href={`${siteUrl}/stories/${story.slug}`} style={{ color: purple, fontSize: "12px", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: "600", letterSpacing: "0.5px", textDecoration: "none" }}>
                      Read Story →
                    </Link>
                  </Column>
                </Row>
              ))}
            </Section>
          ) : (
            <Section style={{ padding: "24px 40px" }}>
              <Text style={{ color: mutedText, fontSize: "14px" }}>No stories featured this week.</Text>
            </Section>
          )}
          <Section style={{ padding: "12px 40px 36px" }}>
            <Section style={{ backgroundColor: lightPurple, borderRadius: "10px", padding: "24px 28px", textAlign: "center" }}>
              <Text style={{ color: darkText, fontSize: "15px", margin: "0 0 14px", lineHeight: "1.6" }}>
                More stories are waiting for you on the platform.
              </Text>
              <Link href={siteUrl} style={{ backgroundColor: purple, color: "#ffffff", padding: "12px 28px", borderRadius: "6px", fontSize: "13px", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: "600", letterSpacing: "0.5px", textDecoration: "none", display: "inline-block" }}>
                Visit Calvary Scribblings
              </Link>
            </Section>
          </Section>
          <Section style={{ backgroundColor: "#1a1a2e", padding: "28px 40px", textAlign: "center" }}>
            <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px", margin: "0 0 8px", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", lineHeight: "1.6" }}>
              You're receiving this because you subscribed to Calvary Scribblings.<br />
              Calvary Media UK Ltd. · calvaryscribblings.co.uk
            </Text>
            <Link href={unsubscribeUrl} style={{ color: "rgba(255,255,255,0.35)", fontSize: "11px", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", textDecoration: "underline" }}>
              Unsubscribe
            </Link>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
