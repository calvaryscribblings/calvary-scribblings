import {
  Html, Head, Body, Container, Section, Row, Column,
  Heading, Text, Link, Img, Hr, Preview,
} from "@react-email/components";

export default function WeeklyDigest({
  subject = "This Week on Calvary Scribblings",
  blocks = [],
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
              The Story Island 🏝️
            </Text>
          </Section>
          {blocks.map((block) => {
            if (block.type === "text") {
              return (
                <Section key={block.id} style={{ padding: "20px 40px" }}>
                  <Text style={{ color: darkText, fontSize: "16px", lineHeight: "1.75", margin: 0, whiteSpace: "pre-wrap" }}>
                    {block.content}
                  </Text>
                </Section>
              );
            }
            if (block.type === "divider") {
              return (
                <Hr
                  key={block.id}
                  style={{
                    borderTop: `2px solid ${purple}`,
                    borderBottom: "none",
                    borderLeft: "none",
                    borderRight: "none",
                    width: "100%",
                    margin: "24px 0",
                  }}
                />
              );
            }
            if (block.type === "story") {
              return (
                <Section key={block.id} style={{ padding: "12px 40px" }}>
                  <Row>
                    {block.cover && (
                      <Column style={{ width: "120px", verticalAlign: "top" }}>
                        <Link href={`${siteUrl}/stories/${block.slug}`}>
                          <Img src={block.cover} width="110" height="70" alt={block.title} style={{ borderRadius: "6px", objectFit: "cover", display: "block" }} />
                        </Link>
                      </Column>
                    )}
                    <Column style={{ verticalAlign: "top", paddingLeft: block.cover ? "16px" : "0" }}>
                      <Text style={{ color: purple, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", margin: "0 0 6px", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: "600" }}>
                        {block.category || "Fiction"}
                      </Text>
                      <Link href={`${siteUrl}/stories/${block.slug}`} style={{ textDecoration: "none" }}>
                        <Heading as="h2" style={{ color: darkText, fontSize: "17px", fontWeight: "700", margin: "0 0 6px", lineHeight: "1.3", fontFamily: "Georgia, 'Times New Roman', serif" }}>
                          {block.title}
                        </Heading>
                      </Link>
                      <Text style={{ color: mutedText, fontSize: "12px", margin: "0 0 8px", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
                        by {block.author}
                      </Text>
                      {block.excerpt && (
                        <Text style={{ color: "#444460", fontSize: "13px", lineHeight: "1.6", margin: "0 0 10px" }}>
                          {block.excerpt.length > 120 ? block.excerpt.slice(0, 120) + "…" : block.excerpt}
                        </Text>
                      )}
                      <Link href={`${siteUrl}/stories/${block.slug}`} style={{ color: purple, fontSize: "12px", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: "600", letterSpacing: "0.5px", textDecoration: "none" }}>
                        Read on Calvary Scribblings →
                      </Link>
                    </Column>
                  </Row>
                </Section>
              );
            }
            return null;
          })}
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
