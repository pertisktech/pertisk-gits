#[tokio::main]
async fn main() -> anyhow::Result<()> {
    pertisk_api::run().await
}
