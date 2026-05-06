//! Tool implementations. Each tool is a small struct + a Tool impl.
//!
//! For v0.1 most tools are auto-generated stubs from the S16 catalog
//! (`crates/s16_tools.json`) so `tools/list` returns the full 140-surface
//! and clients can introspect schemas. Real implementations are registered
//! in [`build_registry`] AFTER the stubs so they override.

pub mod agents;
pub mod blocks;
pub mod cards;
pub mod credentials;
pub mod databases;
pub mod docs;
pub mod files;
pub mod pages;
pub mod properties;
pub mod relations;
pub mod search;
pub mod secrets;
pub mod sites;
pub mod skills;
pub mod stubs;
pub mod templates;
pub mod triggers;
pub mod views;

use crate::registry::Registry;
use std::sync::Arc;

/// Build the tool registry: stubs for all 140 tools, then real
/// implementations override the ones we've actually built.
pub fn build_registry(s16_catalog_json: &str) -> anyhow::Result<Registry> {
    let mut reg = Registry::new();
    stubs::register_all(&mut reg, s16_catalog_json)?;

    // ── real implementations (override stubs) ────────────────────────────
    reg.register(Arc::new(databases::ListDatabases));
    reg.register(Arc::new(databases::GetDatabase));
    reg.register(Arc::new(databases::GetPublicDatabase));
    reg.register(Arc::new(databases::CreateDatabase));
    reg.register(Arc::new(databases::UpdateDatabase));
    reg.register(Arc::new(databases::DeleteDatabase));
    reg.register(Arc::new(databases::ReorderDatabases));
    reg.register(Arc::new(databases::SetDefaultTemplate));

    reg.register(Arc::new(properties::CreateProperty));
    reg.register(Arc::new(properties::UpdateProperty));
    reg.register(Arc::new(properties::DeleteProperty));
    reg.register(Arc::new(properties::DuplicateProperty));
    reg.register(Arc::new(properties::RenamePropertyOption));
    reg.register(Arc::new(properties::DeletePropertyOption));

    reg.register(Arc::new(pages::ListPages));
    reg.register(Arc::new(pages::CountPages));
    reg.register(Arc::new(pages::GetPage));
    reg.register(Arc::new(pages::CreatePage));
    reg.register(Arc::new(pages::UpdatePage));
    reg.register(Arc::new(pages::UpdateCell));
    reg.register(Arc::new(pages::BulkUpdateCells));
    reg.register(Arc::new(pages::GetPageContent));
    reg.register(Arc::new(pages::UpdatePageContent));
    reg.register(Arc::new(pages::ArchivePage));
    reg.register(Arc::new(pages::DeletePage));
    reg.register(Arc::new(pages::BulkDeletePages));
    reg.register(Arc::new(pages::DuplicatePage));
    reg.register(Arc::new(pages::SetPageSharing));
    reg.register(Arc::new(pages::ListPublicPages));
    reg.register(Arc::new(pages::GetPublicPage));
    reg.register(Arc::new(pages::CountPublicPages));

    reg.register(Arc::new(relations::ListRelations));
    reg.register(Arc::new(relations::AddRelation));
    reg.register(Arc::new(relations::RemoveRelation));
    reg.register(Arc::new(relations::ConvertRelationToTwoWay));

    reg.register(Arc::new(docs::ListDocs));
    reg.register(Arc::new(docs::ListAllDocs));
    reg.register(Arc::new(docs::ListDocChildren));
    reg.register(Arc::new(docs::ListTrashDocs));
    reg.register(Arc::new(docs::GetDoc));
    reg.register(Arc::new(docs::GetDocContent));
    reg.register(Arc::new(docs::GetDocAncestors));
    reg.register(Arc::new(docs::GetDocBacklinks));
    reg.register(Arc::new(docs::GetPublicDoc));
    reg.register(Arc::new(docs::CreateDoc));
    reg.register(Arc::new(docs::UpdateDoc));
    reg.register(Arc::new(docs::UpdateDocContent));
    reg.register(Arc::new(docs::SetDocSharing));
    reg.register(Arc::new(docs::MoveDoc));
    reg.register(Arc::new(docs::DuplicateDoc));
    reg.register(Arc::new(docs::DeleteDoc));
    reg.register(Arc::new(docs::RestoreDoc));
    reg.register(Arc::new(docs::DeleteDocPermanently));
    reg.register(Arc::new(docs::ListDocHistory));
    reg.register(Arc::new(docs::GetDocSnapshot));
    reg.register(Arc::new(docs::RestoreDocSnapshot));

    // Flashcards / SRS (#122)
    reg.register(Arc::new(cards::ListDueCards));
    reg.register(Arc::new(cards::ListAllCards));
    reg.register(Arc::new(cards::SetDocFlashcard));
    reg.register(Arc::new(cards::ReviewCard));

    reg.register(Arc::new(search::SearchWorkspace));

    reg.register(Arc::new(agents::ListAgents));
    reg.register(Arc::new(agents::GetAgent));
    reg.register(Arc::new(agents::CreateAgent));
    reg.register(Arc::new(agents::UpdateAgent));
    reg.register(Arc::new(agents::DeleteAgent));
    reg.register(Arc::new(agents::CompileAgent));
    reg.register(Arc::new(agents::GetAgentWebhookUrl));
    reg.register(Arc::new(agents::ListAgentHistory));
    reg.register(Arc::new(agents::RunAgent));
    reg.register(Arc::new(agents::RunAgentByName));
    reg.register(Arc::new(agents::GetRun));
    reg.register(Arc::new(agents::ListRuns));
    reg.register(Arc::new(agents::AwaitRun));
    reg.register(Arc::new(agents::CancelRun));

    reg.register(Arc::new(skills::ListSkills));
    reg.register(Arc::new(skills::CreateSkill));
    reg.register(Arc::new(skills::UpdateSkill));
    reg.register(Arc::new(skills::DeleteSkill));
    reg.register(Arc::new(skills::MarketplaceSkills));
    reg.register(Arc::new(skills::InstallSkill));
    reg.register(Arc::new(skills::UninstallSkill));
    reg.register(Arc::new(skills::PublishSkill));

    reg.register(Arc::new(files::ListFiles));
    reg.register(Arc::new(files::CreateFile));
    reg.register(Arc::new(files::UploadFile));
    reg.register(Arc::new(files::DeleteFile));

    reg.register(Arc::new(credentials::ListCredentialProviders));
    reg.register(Arc::new(credentials::ListCredentials));
    reg.register(Arc::new(credentials::GetCredential));
    reg.register(Arc::new(credentials::CreateCredential));
    reg.register(Arc::new(credentials::UpdateCredential));
    reg.register(Arc::new(credentials::DeleteCredential));
    reg.register(Arc::new(credentials::StartCredentialOauth));
    reg.register(Arc::new(credentials::GetCredentialAuthSession));
    reg.register(Arc::new(credentials::ListMcpTools));
    reg.register(Arc::new(credentials::CallMcpTool));

    reg.register(Arc::new(secrets::SetSecret));
    reg.register(Arc::new(secrets::ListSecrets));
    reg.register(Arc::new(secrets::DeleteSecret));

    reg.register(Arc::new(views::ListViews));
    reg.register(Arc::new(views::CreateView));
    reg.register(Arc::new(views::UpdateView));
    reg.register(Arc::new(views::ReorderViews));
    reg.register(Arc::new(views::DeleteView));

    reg.register(Arc::new(templates::ListTemplates));
    reg.register(Arc::new(templates::GetTemplate));
    reg.register(Arc::new(templates::CreateTemplate));
    reg.register(Arc::new(templates::UpdateTemplate));
    reg.register(Arc::new(templates::DeleteTemplate));
    reg.register(Arc::new(templates::ApplyTemplate));
    reg.register(Arc::new(templates::ApplyTemplateToAll));

    reg.register(Arc::new(triggers::SetTrigger));
    reg.register(Arc::new(triggers::DeleteTrigger));

    reg.register(Arc::new(blocks::ListBlocks));
    reg.register(Arc::new(blocks::CreateBlock));
    reg.register(Arc::new(blocks::UpdateBlock));
    reg.register(Arc::new(blocks::DeleteBlock));

    reg.register(Arc::new(sites::ListSites));
    reg.register(Arc::new(sites::CreateSite));
    reg.register(Arc::new(sites::GetSite));
    reg.register(Arc::new(sites::UpdateSite));
    reg.register(Arc::new(sites::DeleteSite));
    reg.register(Arc::new(sites::ListSitePages));
    reg.register(Arc::new(sites::GetSitePage));
    reg.register(Arc::new(sites::CreateSitePage));
    reg.register(Arc::new(sites::UpdateSitePage));
    reg.register(Arc::new(sites::DeleteSitePage));
    reg.register(Arc::new(sites::PublishSitePage));
    reg.register(Arc::new(sites::ListSitePageFiles));
    reg.register(Arc::new(sites::ReadSitePageFile));
    reg.register(Arc::new(sites::WriteSitePageFile));
    reg.register(Arc::new(sites::EditSitePageFile));
    reg.register(Arc::new(sites::DeleteSitePageFile));
    reg.register(Arc::new(sites::SetSitePageFiles));
    reg.register(Arc::new(sites::ListSiteComponents));
    reg.register(Arc::new(sites::GetSiteComponent));
    reg.register(Arc::new(sites::CreateSiteComponent));
    reg.register(Arc::new(sites::UpdateSiteComponent));
    reg.register(Arc::new(sites::InstallSiteComponent));
    reg.register(Arc::new(sites::DeleteSiteComponent));
    reg.register(Arc::new(sites::ListSiteAssets));
    reg.register(Arc::new(sites::DeleteSiteAsset));

    Ok(reg)
}
